import type { Connection } from '@salesforce/core';
import { asArray, batch, soqlIn, formatSaveError, type SaveResult } from '../shared/sfUtils.js';
import { RELATED_DML_CHUNK_SIZE } from './plan.js';
import { isAbsent } from './sources.js';
import { matchQueryBatches } from './queries.js';
import type { RelatedRecordPlan, RelatedRecordResult, AppliedRelatedRecordResult } from './types.js';

type JsonRecord = Record<string, unknown>;

export type RelatedApplyEntry = { planId: string; relatedPlans: RelatedRecordPlan[]; savedUserId?: string };

type PendingWrite = {
  planId: string;
  plan: RelatedRecordPlan;
  payload: JsonRecord;
};

const baseResult = (plan: RelatedRecordPlan): Pick<RelatedRecordResult, 'relationship' | 'phase' | 'sobject'> => ({
  relationship: plan.relationship,
  phase: plan.phase,
  sobject: plan.sobject,
});

/** Dry-run rendering: no DML, and no `recordId` for a record that does not exist yet. */
export const toDryRunResults = (plans: RelatedRecordPlan[]): RelatedRecordResult[] =>
  plans.map((plan) => {
    if (plan.status === 'failed') {
      return { ...baseResult(plan), action: 'wouldSkip', status: 'failed', error: plan.errors.join('; ') };
    }
    if (plan.status === 'skipped') return { ...baseResult(plan), action: 'wouldSkip', status: 'skipped' };
    return plan.existingId
      ? {
          ...baseResult(plan),
          recordId: plan.existingId,
          action:
            Object.keys(plan.fields).length === 0 && plan.pendingUserIdFields.length === 0 ? 'matched' : 'wouldUpdate',
          status: 'planned',
        }
      : { ...baseResult(plan), action: 'wouldCreate', status: 'planned' };
  });

/** Results for plans a live run never reached (user validation errors or a failed User save). */
export const toUnappliedResults = (plans: RelatedRecordPlan[]): RelatedRecordResult[] =>
  plans.map((plan) =>
    plan.status === 'failed'
      ? { ...baseResult(plan), action: 'skipped', status: 'failed', error: plan.errors.join('; ') }
      : { ...baseResult(plan), action: 'skipped', status: 'skipped' }
  );

const buildPayload = (plan: RelatedRecordPlan, savedUserId?: string): JsonRecord => {
  const fields: JsonRecord = { ...plan.fields };
  for (const name of plan.pendingUserIdFields) fields[name] = savedUserId;
  if (plan.existingId) return { ...fields, Id: plan.existingId };
  return plan.recordTypeId ? { ...fields, RecordTypeId: plan.recordTypeId } : fields;
};

const isMatchedWithoutChanges = (plan: RelatedRecordPlan): boolean =>
  Boolean(plan.existingId) && Object.keys(plan.fields).length === 0 && plan.pendingUserIdFields.length === 0;

const recordOutcome = (
  write: PendingWrite,
  saveResult: SaveResult | undefined,
  resultsByPlanId: Map<string, AppliedRelatedRecordResult[]>
): void => {
  const { plan } = write;
  const isUpdate = Boolean(plan.existingId);
  const succeeded = saveResult?.success === true && Boolean(saveResult.id ?? plan.existingId);
  const results = resultsByPlanId.get(write.planId) ?? [];
  if (succeeded) {
    results.push({
      ...baseResult(plan),
      recordId: saveResult?.id ?? plan.existingId,
      action: isUpdate ? 'updated' : 'created',
      createdInThisRun: !isUpdate,
      status: 'applied',
    });
  } else {
    const errors = (saveResult?.errors ?? []).map((error) => formatSaveError(error));
    const error = errors.length > 0 ? errors.join('; ') : 'Related record save returned no result.';
    plan.errors.push(error);
    plan.status = 'failed';
    results.push({
      ...baseResult(plan),
      ...(plan.existingId ? { recordId: plan.existingId } : {}),
      action: 'skipped',
      status: 'failed',
      createdInThisRun: false,
      error,
    });
  }
  resultsByPlanId.set(write.planId, results);
};

const runPartitionedDml = async (
  writes: PendingWrite[],
  operation: (payloads: JsonRecord[]) => Promise<SaveResult | SaveResult[]>,
  resultsByPlanId: Map<string, AppliedRelatedRecordResult[]>,
  beforeBatch: () => void = (): void => undefined
): Promise<void> => {
  const partitions = batch(writes, RELATED_DML_CHUNK_SIZE);
  for (const partition of partitions) {
    beforeBatch();
    // Ordered requests: each partition is at most 200 records, matching the User save shape.
    // eslint-disable-next-line no-await-in-loop
    const saveResults = asArray(await operation(partition.map((write) => write.payload)));
    partition.forEach((write, idx) => recordOutcome(write, saveResults[idx], resultsByPlanId));
  }
};

/**
 * Apply the requested phase as bulk DML per sObject.
 *
 * Results are mapped to the owning plan; orchestration decides whether a failure
 * prevents the User save or is reported after it.
 */
export const applyRelatedPhase = async (
  conn: Connection,
  entries: RelatedApplyEntry[],
  phase: 'before' | 'after',
  beforeBatch: () => void = (): void => undefined
): Promise<Map<string, AppliedRelatedRecordResult[]>> => {
  const resultsByPlanId = new Map<string, AppliedRelatedRecordResult[]>();
  const writes: PendingWrite[] = [];
  for (const entry of entries) {
    for (const plan of entry.relatedPlans) {
      if (plan.phase !== phase) continue;
      if (plan.status !== 'planned') {
        resultsByPlanId.set(entry.planId, (resultsByPlanId.get(entry.planId) ?? []).concat(toUnappliedResults([plan])));
        continue;
      }
      if (isMatchedWithoutChanges(plan)) {
        resultsByPlanId.set(
          entry.planId,
          (resultsByPlanId.get(entry.planId) ?? []).concat({
            ...baseResult(plan),
            recordId: plan.existingId,
            action: 'matched',
            status: 'applied',
          })
        );
        continue;
      }
      writes.push({ planId: entry.planId, plan, payload: buildPayload(plan, entry.savedUserId) });
    }
  }
  if (writes.length === 0) return resultsByPlanId;

  const sobjects = [...new Set(writes.map((write) => write.plan.sobject))];
  for (const sobject of sobjects) {
    const forSobject = writes.filter((write) => write.plan.sobject === sobject);
    const creates = forSobject.filter((write) => !write.plan.existingId);
    const updates = forSobject.filter((write) => Boolean(write.plan.existingId));
    /* eslint-disable no-await-in-loop */
    if (creates.length > 0) {
      await runPartitionedDml(
        creates,
        (payloads) => conn.sobject(sobject).create(payloads, { allOrNone: false }) as Promise<SaveResult[]>,
        resultsByPlanId,
        beforeBatch
      );
    }
    if (updates.length > 0) {
      await runPartitionedDml(
        updates,
        (payloads) =>
          conn.sobject(sobject).update(payloads as Array<JsonRecord & { Id: string }>, { allOrNone: false }) as Promise<
            SaveResult[]
          >,
        resultsByPlanId,
        beforeBatch
      );
    }
    /* eslint-enable no-await-in-loop */
  }
  return resultsByPlanId;
};

type BeforeEntry = { planId: string; relatedPlans: RelatedRecordPlan[]; target: JsonRecord };
type LinkRead = { sobject: string; field: string; ids: Set<string> };

const collectLinkReads = (
  entries: BeforeEntry[],
  applied: Map<string, AppliedRelatedRecordResult[]>
): Map<string, LinkRead> => {
  const reads = new Map<string, LinkRead>();
  for (const entry of entries)
    for (const plan of entry.relatedPlans) {
      if (
        plan.phase !== 'before' ||
        !plan.linkUser ||
        plan.existingId !== undefined ||
        plan.linkUser.fromRelatedField.toLowerCase() === 'id'
      )
        continue;
      const result = applied.get(entry.planId)?.find((r) => r.relationship === plan.relationship);
      if (result?.status !== 'applied' || !result.recordId) continue;
      const key = `${plan.sobject}|${plan.linkUser.fromRelatedField}`;
      const group = reads.get(key) ?? {
        sobject: plan.sobject,
        field: plan.linkUser.fromRelatedField,
        ids: new Set<string>(),
      };
      group.ids.add(result.recordId);
      reads.set(key, group);
    }
  return reads;
};

/** Apply the before stage and resolve linking fields before any User save. */
export const applyBeforeRelatedPhase = async (
  conn: Connection,
  entries: Array<{ planId: string; relatedPlans: RelatedRecordPlan[]; target: JsonRecord }>,
  beforeBatch: () => void = (): void => undefined
): Promise<Map<string, { results: AppliedRelatedRecordResult[]; failed: boolean }>> => {
  const applied = await applyRelatedPhase(conn, entries, 'before', beforeBatch);
  const reads = collectLinkReads(entries, applied);
  const values = new Map<string, unknown>();
  const readErrors = new Map<string, string>();
  for (const [key, group] of reads) {
    const prefix = `SELECT Id, ${group.field} FROM ${group.sobject} WHERE Id IN (`;
    for (const chunk of matchQueryBatches([...group.ids], prefix)) {
      beforeBatch();
      try {
        // eslint-disable-next-line no-await-in-loop
        const rows = (await conn.query<Record<string, unknown>>(`${prefix}${soqlIn(chunk)})`)).records;
        for (const row of rows) values.set(`${key}|${String(row.Id)}`, row[group.field]);
      } catch (error) {
        for (const id of chunk) readErrors.set(`${key}|${id}`, error instanceof Error ? error.message : String(error));
      }
    }
  }
  const outcomes = new Map<string, { results: AppliedRelatedRecordResult[]; failed: boolean }>();
  for (const entry of entries) {
    const results = applied.get(entry.planId);
    if (!results) continue;
    for (const plan of entry.relatedPlans) {
      if (plan.phase !== 'before' || !plan.linkUser) continue;
      const result = results.find((r) => r.relationship === plan.relationship);
      if (result?.status !== 'applied') continue;
      const key = `${plan.sobject}|${plan.linkUser.fromRelatedField}|${result.recordId ?? ''}`;
      const value = plan.existingId
        ? Object.hasOwn(plan.fields, plan.linkUser.fromRelatedField)
          ? plan.fields[plan.linkUser.fromRelatedField]
          : plan.linkValue
        : plan.linkUser.fromRelatedField.toLowerCase() === 'id'
        ? result.recordId
        : values.get(key);
      if (isAbsent(value)) {
        result.status = 'failed';
        result.error = `Cannot resolve ${plan.sobject}.${plan.linkUser.fromRelatedField} for User.${
          plan.linkUser.userField
        }.${readErrors.has(key) ? ` ${readErrors.get(key) ?? ''}` : ''}`;
      } else entry.target[plan.linkUser.userField] = value;
    }
    outcomes.set(entry.planId, { results, failed: results.some((r) => r.status === 'failed') });
  }
  return outcomes;
};

/** Shared orchestration for callable and legacy provisioning. */
export const applyBeforeUserSaves = async (
  conn: Connection,
  plans: Array<{
    planId: string;
    relatedPlans?: RelatedRecordPlan[];
    target: JsonRecord;
    errors: string[];
    relatedResults?: AppliedRelatedRecordResult[];
  }>,
  beforeBatch?: () => void
): Promise<void> => {
  const outcomes = await applyBeforeRelatedPhase(
    conn,
    plans
      .filter((p) => p.errors.length === 0 && p.relatedPlans)
      .map((p) => ({ planId: p.planId, relatedPlans: p.relatedPlans!, target: p.target })),
    beforeBatch
  );
  for (const plan of plans) {
    const outcome = outcomes.get(plan.planId);
    if (!outcome) continue;
    plan.relatedResults = outcome.results;
    if (outcome.failed)
      plan.errors.push(
        ...outcome.results.filter((r) => r.status === 'failed').map((r) => r.error ?? 'Before relationship failed.')
      );
  }
};
