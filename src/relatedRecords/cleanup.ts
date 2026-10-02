import type { Connection } from '@salesforce/core';
import { asArray, batch, formatSaveError, type SaveResult } from '../shared/sfUtils.js';
import { provisioningMessage } from '../provisioning/messages.js';
import type { OrderedUserResult, UserPlan } from '../provisioning/userPlan.js';
import { RELATED_DML_CHUNK_SIZE } from './plan.js';
import type { AppliedRelatedRecordResult, RelatedMessage, RelatedRecordPlan, RelatedRecordResult } from './types.js';

export type CleanupEntry = {
  planId: string;
  userSaved: boolean;
  linkedFields: string[];
  relatedPlans: RelatedRecordPlan[];
  results: AppliedRelatedRecordResult[];
};

type Candidate = { planId: string; result: AppliedRelatedRecordResult; recordId: string };

const recordIdentity = (
  result: RelatedRecordResult
): Pick<RelatedRecordResult, 'relationship' | 'phase' | 'sobject' | 'recordId'> => ({
  relationship: result.relationship,
  phase: result.phase,
  sobject: result.sobject,
  recordId: result.recordId,
});

/** Remove internal ownership tracking at the public result boundary. */
export const publicRelatedResults = (results: AppliedRelatedRecordResult[]): RelatedRecordResult[] =>
  results.map((result) => {
    const publicResult = { ...result };
    delete publicResult.createdInThisRun;
    return publicResult;
  });

/** Best-effort compensation, ordered after-before and batched across failed users. */
export const cleanupFailedPlans = async (
  conn: Connection,
  entries: CleanupEntry[],
  options: { message?: RelatedMessage } = {}
): Promise<Map<string, RelatedRecordResult[]>> => {
  const message = options.message ?? provisioningMessage;
  const results = new Map<string, RelatedRecordResult[]>();
  const append = (planId: string, result: RelatedRecordResult): void => {
    results.set(planId, (results.get(planId) ?? []).concat(result));
  };
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    for (const result of entry.results) {
      if (!result.createdInThisRun || !result.recordId || result.sobject.toLowerCase() === 'user') continue;
      const relatedPlan = entry.relatedPlans.find((plan) => plan.relationship === result.relationship);
      const field = relatedPlan?.linkUser?.userField;
      if (entry.userSaved && result.phase === 'before' && field && entry.linkedFields.includes(field)) {
        append(entry.planId, {
          ...recordIdentity(result),
          action: 'skipped',
          status: 'skipped',
          detail: message('detailRelatedRetainedLinkedUser', [field]),
        });
      } else candidates.push({ planId: entry.planId, result, recordId: result.recordId });
    }
  }
  // Once compensation starts it finishes best-effort; cancellation is checked by
  // the caller before entering this stage, never caught as a delete failure.
  for (const phase of ['after', 'before']) {
    const phaseCandidates = candidates.filter((candidate) => candidate.result.phase === phase);
    const sobjects = [...new Set(phaseCandidates.map((candidate) => candidate.result.sobject))];
    for (const sobject of sobjects) {
      for (const partition of batch(
        phaseCandidates.filter((candidate) => candidate.result.sobject === sobject),
        RELATED_DML_CHUNK_SIZE
      )) {
        let outcomes: SaveResult[];
        try {
          /* eslint-disable no-await-in-loop -- Deletes must preserve phase dependency order. */
          outcomes = asArray(
            (await conn.sobject(sobject).delete(
              partition.map((candidate) => candidate.recordId),
              { allOrNone: false }
            )) as SaveResult[]
          );
          /* eslint-enable no-await-in-loop */
        } catch (error) {
          outcomes = partition.map(() => ({
            success: false,
            errors: [{ message: error instanceof Error ? error.message : String(error) }],
          }));
        }
        partition.forEach((candidate, index) => {
          const outcome = outcomes[index];
          append(candidate.planId, {
            ...recordIdentity(candidate.result),
            action: outcome?.success ? 'deleted' : 'deleteFailed',
            status: outcome?.success ? 'applied' : 'failed',
            ...(outcome?.success
              ? {}
              : {
                  error: outcome?.errors.length
                    ? outcome.errors.map(formatSaveError).join('; ')
                    : 'Related record delete returned no result.',
                }),
          });
        });
      }
    }
  }
  return results;
};

/** Shared final stage for callable and legacy provision APIs. */
export const cleanupProvisionFailures = async (
  conn: Connection,
  plans: UserPlan[],
  results: OrderedUserResult[],
  savedPlanIds: string[]
): Promise<void> => {
  const plansById = new Map(plans.map((plan) => [plan.planId, plan]));
  const saved = new Set(savedPlanIds);
  const entries: CleanupEntry[] = results
    .filter((result) => result.status === 'failed' && result.relatedRecords?.length)
    .map((result) => {
      const plan = plansById.get(result.planId)!;
      return {
        planId: result.planId,
        userSaved: saved.has(result.planId),
        linkedFields: (plan.relatedPlans ?? []).flatMap((related) =>
          related.linkUser && Object.hasOwn(plan.target, related.linkUser.userField) ? [related.linkUser.userField] : []
        ),
        relatedPlans: plan.relatedPlans ?? [],
        results: result.relatedRecords ?? [],
      };
    });
  const cleanup = await cleanupFailedPlans(conn, entries);
  for (const result of results) {
    const additions = cleanup.get(result.planId);
    if (additions) result.relatedRecords = (result.relatedRecords ?? []).concat(additions);
  }
};
