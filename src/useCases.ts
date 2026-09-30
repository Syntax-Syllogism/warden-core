import type { Connection } from '@salesforce/core';
import { z } from 'zod';
import { getResolver } from './access/resolvers/index.js';
import { resolveReverseAccess } from './access/reverse.js';
import type { UserAccessResult, ValidatedAccessTarget } from './access/types.js';
import { describeUserFields } from './shared/userFields.js';
import { parseUserFlag, resolveTargetField, resolveTargets, extractDefTargets } from './lifecycle/targeting.js';
import { lifecycleMessage } from './lifecycle/messages.js';
import { LifecycleError } from './lifecycle/errors.js';
import { failedResult, makeNotice, resolvedTargetResult, summarizeLifecycle } from './lifecycle/output.js';
import type {
  IdentityReview,
  LifecycleResult,
  LifecycleUserResult,
  ResolvedTargetUser,
  TargetError,
  TargetRequest,
  LabelBundle,
} from './lifecycle/types.js';
import { loadAssignmentState, type AssignmentState, type UserLoginRow } from './lifecycle/assignmentState.js';
import { runAssignmentCreates, runRecordUpdate } from './lifecycle/dmlRunner.js';
import { buildSnapshotFile, type UserSnapshotFile, type UserSnapshotEntry } from './lifecycle/snapshotState.js';
import { parseSnapshot } from './spec/parse.js';
import { buildTargetState, type StripTargetState } from './lifecycle/stripPlan.js';
import { applyStripState } from './lifecycle/stripApply.js';
import { FREEZE, UNFREEZE, type FreezeDirection } from './lifecycle/freezeState.js';
import {
  provisionOptionsSchema,
  freezeOptionsSchema,
  unfreezeOptionsSchema,
  stripOptionsSchema,
  diffOptionsSchema,
  accessOptionsSchema,
  snapshotOptionsSchema,
  restoreOptionsSchema,
  type ProvisionOptions,
  type FreezeOptions,
  type UnfreezeOptions,
  type StripOptions,
  type DiffOptions,
  type AccessOptions,
  type SnapshotOptions,
  type RestoreOptions,
} from './commandOptions.js';
import {
  checkCancelled,
  endProgress,
  startProgress,
  type CommandDescriptor,
  type ReadUseCase,
  type UseCaseContext,
  type WriteUseCase,
} from './useCase.js';
import type { ProvisionResult } from './provisioning/provisionUserUseCase.js';
import { resolveDefinitions } from './provisioning/definitionReader.js';
import { buildUserPlans, type UserPlan, type OrderedUserResult } from './provisioning/userPlan.js';
import { resolveReferences } from './provisioning/referenceResolution.js';
import type { ResolvedRefs } from './provisioning/assignmentPlan.js';
import {
  validateAndCanonicalizeUsers,
  validateExternalIdFieldForFlag,
  validatePersonaModes,
  type PersonaDefinition,
} from './provisioning/planner.js';
import { addSourceContext, getExistingUsers, validationResultsFor } from './provisioning/provisionUserUseCase.js';
import { calculateUserLicenseUsage, type UserLicenseUsage } from './provisioning/licenseUsage.js';
import {
  applySavedPlan,
  executeBulkUserSaves,
  planDryRunResult,
  markRelatedUnapplied,
} from './provisioning/userSave.js';
import { runRelatedPreflight, emptyPreflightResult, type RelatedPreflightResult } from './relatedRecords/preflight.js';
import { applyRelatedPhase } from './relatedRecords/apply.js';
import { buildRelatedPlans } from './relatedRecords/plan.js';
import { assertValidRelatedCatalog } from './relatedRecords/catalog.js';
import type { RelatedRecordPlan } from './relatedRecords/types.js';
import { deriveMyDomain } from './provisioning/planner.js';
import { provisioningMessage } from './provisioning/messages.js';
import { summarize, toUserResult } from './provisioning/userPlan.js';
import { soqlIn } from './shared/sfUtils.js';

type JsonRecord = Record<string, unknown>;

const descriptor = <O>(
  id: CommandDescriptor<O>['id'],
  title: string,
  destructive: boolean,
  optionsSchema: z.ZodType<O>
): CommandDescriptor<O> => ({
  id,
  title,
  group: 'User Lifecycle',
  destructive,
  optionsSchema,
});

const runRead = async <R>(ctx: UseCaseContext | undefined, work: () => Promise<R>): Promise<R> => {
  startProgress(ctx);
  const result = await work();
  endProgress(ctx);
  return result;
};

const conformanceMessage = (key: string, args: string[] = []): string => {
  const templates: Record<string, string> = {
    'verify.violation.notFound': 'user not found',
    'verify.violation.error': 'error: %s',
    'verify.violation.missing': '%s missing: %s',
    'verify.violation.extra': '%s extra (sync): %s',
    'verify.violation.profile': 'profile mismatch: %s -> %s',
    'verify.violation.role': 'role mismatch: %s -> %s',
  };
  return (templates[key] ?? key).replaceAll('%s', () => args.shift() ?? '');
};

const targetRequests = async (
  conn: Connection,
  options: {
    user?: string;
    usersPath?: string;
    usersDoc?: JsonRecord;
    externalId?: string;
    inputFormat?: string;
    csvListDelimiter?: string;
  },
  fieldMap: Awaited<ReturnType<typeof describeUserFields>>
): Promise<{ requests: TargetRequest[]; errors: TargetError[] }> => {
  if (options.user) {
    const parsed = parseUserFlag(options.user);
    const field = resolveTargetField(parsed.field, fieldMap);
    if (!field) throw new Error(lifecycleMessage('errorInvalidUserMatchField', [parsed.field]));
    return { requests: [{ key: `${field}:${parsed.value}`, field, value: parsed.value, order: 0 }], errors: [] };
  }
  if (options.usersDoc) return extractDefTargets(options.usersDoc, options.externalId, fieldMap);
  if (!options.usersPath) throw new Error('A user or users definition is required.');
  const { buildTargetRequests } = await import('./lifecycle/targeting.js');
  return buildTargetRequests(
    {
      user: undefined,
      'users-def': options.usersPath,
      'external-id': options.externalId,
      'input-format': options.inputFormat as 'json' | 'csv' | undefined,
      'csv-list-delimiter': options.csvListDelimiter,
    },
    fieldMap
  );
};

const resolveTargetSelection = async (
  conn: Connection,
  options: Parameters<typeof targetRequests>[1],
  fieldMap: Awaited<ReturnType<typeof describeUserFields>>
): Promise<{ targets: ResolvedTargetUser[]; errors: TargetError[] }> => {
  const requested = await targetRequests(conn, options, fieldMap);
  const resolved = await resolveTargets(conn, requested.requests, fieldMap);
  return { targets: resolved.targets, errors: requested.errors.concat(resolved.errors) };
};

const freezePlan = async (
  conn: Connection,
  options: FreezeOptions | UnfreezeOptions,
  direction: FreezeDirection,
  ctx?: UseCaseContext
): Promise<FreezePlan> => {
  checkCancelled(ctx);
  const fieldMap = await describeUserFields(conn);
  const selection = await resolveTargetSelection(conn, options, fieldMap);
  const targets = selection.targets;
  const rows = targets.length
    ? (
        await conn.query<UserLoginRow>(
          `SELECT Id, UserId, IsFrozen FROM UserLogin WHERE UserId IN (${soqlIn(targets.map((target) => target.Id))})`
        )
      ).records
    : [];
  const byUserId = new Map(rows.map((row) => [row.UserId, row]));
  const users = selection.errors.map(failedResult);
  const updates: FreezeUpdate[] = [];
  for (const target of targets) {
    checkCancelled(ctx);
    const login = byUserId.get(target.Id);
    const result = resolvedTargetResult(target, login);
    if (!login) result.warnings.push(lifecycleMessage('warningMissingUserLogin'));
    else if (direction.isAlreadyInState(login)) result.actions.push(makeNotice(direction.alreadyKey));
    else {
      result.status = 'planned';
      result.actions.push(makeNotice(direction.wouldKey));
      updates.push({
        resultIndex: users.length,
        row: { Id: login.Id, IsFrozen: direction.targetState },
        actionKey: direction.actionKey,
      });
    }
    users.push(result);
  }
  return { direction: direction.targetState ? 'freeze' : 'unfreeze', users, updates, warnings: [] };
};

type FreezeUpdate = { resultIndex: number; row: { Id: string; IsFrozen: boolean }; actionKey: string };
export type FreezePlan = {
  direction: 'freeze' | 'unfreeze';
  users: LifecycleUserResult[];
  updates: FreezeUpdate[];
  warnings: string[];
};

const applyFreezePlan = async (conn: Connection, plan: FreezePlan, ctx?: UseCaseContext): Promise<LifecycleResult> => {
  startProgress(ctx, 'apply');
  const users = plan.users.map((user) => ({
    ...user,
    status: user.status === 'planned' ? ('unchanged' as const) : user.status,
    actions: user.actions.filter((action) => action.key !== 'wouldFreeze' && action.key !== 'wouldUnfreeze'),
    errors: [...user.errors],
    warnings: [...user.warnings],
  }));
  if (plan.updates.length > 0) {
    const saved = await conn.sobject('UserLogin').update(
      plan.updates.map((update) => update.row),
      { allOrNone: false }
    );
    const results = Array.isArray(saved) ? saved : [saved];
    results.forEach((saveResult: { success: boolean; errors?: Array<{ message?: string }> }, index: number) => {
      const user = users[plan.updates[index].resultIndex];
      if (saveResult.success) {
        user.status = 'changed';
        user.actions.push(makeNotice(plan.updates[index].actionKey));
      } else {
        user.status = 'failed';
        user.errors.push(...(saveResult.errors ?? []).map((error) => error.message ?? String(error)));
      }
    });
  }
  endProgress(ctx);
  return { summary: summarizeLifecycle(users), users };
};

export const freeze: WriteUseCase<FreezeOptions, FreezePlan, LifecycleResult> = {
  kind: 'write',
  descriptor: descriptor('freeze', 'Freeze', false, freezeOptionsSchema),
  plan: (conn, options, ctx) => runRead(ctx, () => freezePlan(conn, options, FREEZE, ctx)),
  apply: applyFreezePlan,
};

export const unfreeze: WriteUseCase<UnfreezeOptions, FreezePlan, LifecycleResult> = {
  kind: 'write',
  descriptor: descriptor('unfreeze', 'Unfreeze', false, unfreezeOptionsSchema),
  plan: (conn, options, ctx) => runRead(ctx, () => freezePlan(conn, options, UNFREEZE, ctx)),
  apply: applyFreezePlan,
};

export type StripPlan = {
  states: StripTargetState[];
  errors: TargetError[];
  preview: LifecycleResult;
  warnings: string[];
};

const stripFlags = (options: StripOptions): Record<string, unknown> => ({
  user: options.user,
  'users-def': options.usersPath,
  'external-id': options.externalId,
  'input-format': options.inputFormat,
  'csv-list-delimiter': options.csvListDelimiter,
  'no-freeze': options.noFreeze,
  'no-deactivate': options.noDeactivate,
  'keep-permsets': options.keepPermsets,
  'keep-permset-groups': options.keepPermsetGroups,
  'keep-public-groups': options.keepPublicGroups,
  'keep-queues': options.keepQueues,
  'keep-licenses': options.keepLicenses,
});

const makeStripPlan = async (conn: Connection, options: StripOptions, ctx?: UseCaseContext): Promise<StripPlan> => {
  checkCancelled(ctx);
  const fieldMap = await describeUserFields(conn);
  const selection = await resolveTargetSelection(conn, options, fieldMap);
  const stateMaps = await loadAssignmentState(
    conn,
    selection.targets.map((target) => target.Id)
  );
  const flags = stripFlags(options);
  const states = selection.targets.map((target) =>
    buildTargetState({
      target,
      loginRows: stateMaps.userLoginByUserId.get(target.Id) ?? [],
      rows: {
        psa: stateMaps.psaByUserId.get(target.Id) ?? [],
        group: stateMaps.groupByUserId.get(target.Id) ?? [],
        psl: stateMaps.pslByUserId.get(target.Id) ?? [],
      },
      flags,
    })
  );
  const previewStates = selection.targets.map((target) =>
    buildTargetState({
      target,
      loginRows: stateMaps.userLoginByUserId.get(target.Id) ?? [],
      rows: {
        psa: stateMaps.psaByUserId.get(target.Id) ?? [],
        group: stateMaps.groupByUserId.get(target.Id) ?? [],
        psl: stateMaps.pslByUserId.get(target.Id) ?? [],
      },
      flags: { ...flags, 'dry-run': true },
    })
  );
  const previewUsers = selection.errors.map(failedResult).concat(previewStates.map((state) => state.result));
  return {
    states,
    errors: selection.errors,
    preview: { summary: summarizeLifecycle(previewUsers), users: previewUsers },
    warnings: [],
  };
};

export const strip: WriteUseCase<StripOptions, StripPlan, LifecycleResult> = {
  kind: 'write',
  descriptor: descriptor('strip', 'Strip', true, stripOptionsSchema),
  plan: (conn, options, ctx) => runRead(ctx, () => makeStripPlan(conn, options, ctx)),
  apply: async (conn, plan, ctx) => {
    startProgress(ctx, 'apply');
    for (const state of plan.states) {
      checkCancelled(ctx);
      // eslint-disable-next-line no-await-in-loop
      await applyStripState(conn, state);
    }
    const users = plan.errors.map(failedResult).concat(plan.states.map((state) => state.result));
    endProgress(ctx);
    return { summary: summarizeLifecycle(users), users };
  },
};

export const diff: ReadUseCase<
  DiffOptions,
  | Awaited<ReturnType<typeof import('./lifecycle/userDiff.js').executePersonaDiff>>
  | Array<import('./lifecycle/conformance.js').UserConformanceVerdict>
> = {
  kind: 'read',
  descriptor: descriptor('diff', 'Diff', false, diffOptionsSchema),
  run: (conn, options, ctx) =>
    runRead(ctx, async () => {
      if (options.mode === 'user') {
        if (!options.user || !options.against) throw new Error('Both user and against are required in user mode.');
        if (options.verify)
          throw new LifecycleError('errorVerifyUserMode', 'Verification is only available in persona mode.');
        const { executeUserToUserDiff } = await import('./lifecycle/userDiff.js');
        return executeUserToUserDiff({ connection: conn, user: options.user, against: options.against });
      }
      const { executePersonaDiff } = await import('./lifecycle/userDiff.js');
      const definitions = options.usersDoc
        ? {
            usersDoc: options.usersDoc,
            personasDoc: options.personasDoc,
            personasSupplied: options.personasDoc !== undefined,
          }
        : { usersPath: options.usersPath, personasPath: options.personasPath };
      const result = await executePersonaDiff({
        connection: conn,
        ...definitions,
        inputFormat: options.inputFormat as 'json' | 'csv' | undefined,
        csvListDelimiter: options.csvListDelimiter,
        externalId: options.externalId,
      });
      if (!options.verify) return result;
      const { verifyUserDiff } = await import('./lifecycle/conformance.js');
      return verifyUserDiff(result, conformanceMessage);
    }),
};

export const access: ReadUseCase<AccessOptions, UserAccessResult> = {
  kind: 'read',
  descriptor: descriptor('access', 'Access', false, accessOptionsSchema),
  run: (conn, options, ctx) =>
    runRead(ctx, async () => {
      const resolver = getResolver(options.type);
      const hasTarget = Boolean(options.target);
      const hasUser = Boolean(options.user);
      if (options.target && options.sobject)
        throw new LifecycleError('errorAccessScopesMutuallyExclusive', 'target and sobject are mutually exclusive.');
      if (!hasTarget && !hasUser) throw new Error('An access target or user is required.');
      let target: ValidatedAccessTarget;
      if (options.target) target = await resolver.validateTarget(conn, options.target);
      else {
        if (!options.sobject || (options.type !== 'field' && options.type !== 'object'))
          throw new Error('SObject scope is only valid for field and object access.');
        const objectTarget = await getResolver('object').validateTarget(conn, options.sobject);
        target = { ...objectTarget, type: options.type };
      }
      if (!options.user) return resolver.resolve(conn, target);
      const fieldMap = await describeUserFields(conn);
      const parsed = parseUserFlag(options.user);
      const field = resolveTargetField(parsed.field, fieldMap);
      if (!field) throw new Error(lifecycleMessage('errorInvalidUserMatchField', [parsed.field]));
      const resolved = await resolveTargets(
        conn,
        [{ key: `${field}:${parsed.value}`, field, value: parsed.value, order: 0 }],
        fieldMap
      );
      if (resolved.errors.length > 0 || !resolved.targets[0])
        throw new Error(resolved.errors[0]?.message ?? 'User resolution failed.');
      const user = resolved.targets[0];
      return resolveReverseAccess(
        conn,
        { Id: user.Id, name: user.name ?? user.Id, username: user.username ?? '' },
        target
      );
    }),
};

export const snapshot: ReadUseCase<SnapshotOptions, UserSnapshotFile> = {
  kind: 'read',
  descriptor: descriptor('snapshot', 'Snapshot', false, snapshotOptionsSchema),
  run: (conn, options, ctx) =>
    runRead(ctx, async () => {
      const fieldMap = await describeUserFields(conn);
      const selection = await resolveTargetSelection(conn, options, fieldMap);
      if (selection.errors.length > 0) throw new Error(selection.errors.map((error) => error.message).join('; '));
      const state = await loadAssignmentState(
        conn,
        selection.targets.map((target) => target.Id)
      );
      return buildSnapshotFile(conn, selection.targets, state, options.org);
    }),
};

export type ProvisionPlan = {
  plans: UserPlan[];
  refs: SerializedRefs;
  validationResults: OrderedUserResult[];
  licenses: UserLicenseUsage[];
  preview: ProvisionResult;
  warnings: string[];
};

const publicProvisionResult = (result: OrderedUserResult): ProvisionResult['users'][number] => ({
  key: result.key,
  ...(result.id === undefined ? {} : { id: result.id }),
  ...(result.userName === undefined ? {} : { userName: result.userName }),
  ...(result.username === undefined ? {} : { username: result.username }),
  personas: result.personas,
  matchedBy: result.matchedBy ?? null,
  matchValue: result.matchValue,
  matched: result.matched,
  status: result.status,
  actions: result.actions,
  errors: addSourceContext(result.source, result.errors),
  ...(result.relatedRecords ? { relatedRecords: result.relatedRecords } : {}),
});

type SerializedRefs = Omit<
  ResolvedRefs,
  | 'profilesByRef'
  | 'rolesByRef'
  | 'permissionSetIdsByRef'
  | 'permissionSetGroupIdsByRef'
  | 'publicGroupIdsByRef'
  | 'queueIdsByRef'
> & {
  profilesByRef: Record<string, string>;
  rolesByRef: Record<string, string>;
  permissionSetIdsByRef: Record<string, string>;
  permissionSetGroupIdsByRef: Record<string, string>;
  publicGroupIdsByRef: Record<string, string>;
  queueIdsByRef: Record<string, string>;
};

const serializeRefs = (refs: ResolvedRefs): SerializedRefs => ({
  profilesByRef: Object.fromEntries(refs.profilesByRef),
  rolesByRef: Object.fromEntries(refs.rolesByRef),
  permissionSetIdsByRef: Object.fromEntries(refs.permissionSetIdsByRef),
  permissionSetGroupIdsByRef: Object.fromEntries(refs.permissionSetGroupIdsByRef),
  publicGroupIdsByRef: Object.fromEntries(refs.publicGroupIdsByRef),
  queueIdsByRef: Object.fromEntries(refs.queueIdsByRef),
  labels: refs.labels,
  warnings: refs.warnings,
});

const deserializeRefs = (refs: SerializedRefs): ResolvedRefs => ({
  profilesByRef: new Map(Object.entries(refs.profilesByRef)),
  rolesByRef: new Map(Object.entries(refs.rolesByRef)),
  permissionSetIdsByRef: new Map(Object.entries(refs.permissionSetIdsByRef)),
  permissionSetGroupIdsByRef: new Map(Object.entries(refs.permissionSetGroupIdsByRef)),
  publicGroupIdsByRef: new Map(Object.entries(refs.publicGroupIdsByRef)),
  queueIdsByRef: new Map(Object.entries(refs.queueIdsByRef)),
  labels: refs.labels,
  warnings: refs.warnings,
});

const provisionPlan = async (
  conn: Connection,
  options: ProvisionOptions,
  ctx?: UseCaseContext
): Promise<ProvisionPlan> => {
  checkCancelled(ctx);
  const input = {
    connection: conn,
    usersDoc: options.usersDoc,
    personasDoc: options.personasDoc,
    relatedDoc: options.relatedDoc,
    usersPath: options.usersPath,
    personasPath: options.personasPath,
    relatedPath: options.relatedPath,
    inputFormat: options.inputFormat as 'json' | 'csv' | undefined,
    csvListDelimiter: options.csvListDelimiter,
    externalId: options.externalId,
    fuzzyUsername: options.fuzzyUsername,
    dryRun: false,
  } as const;
  const fieldMap = await describeUserFields(conn);
  const definitions = await resolveDefinitions(input, fieldMap);
  const personas = definitions.personasDoc.personas as Record<string, PersonaDefinition>;
  validatePersonaModes(personas);
  validateExternalIdFieldForFlag(options.externalId, fieldMap);
  const catalog = definitions.relatedDoc ? assertValidRelatedCatalog(definitions.relatedDoc, fieldMap) : undefined;
  const users = validateAndCanonicalizeUsers(
    definitions.usersDoc.users,
    personas,
    fieldMap,
    options.personasSupplied ?? definitions.personasSupplied,
    {
      catalogSupplied: Boolean(catalog),
      names: new Set(Object.keys(catalog?.relationships ?? {})),
    }
  );
  const entries = users.map((user, order) => ({ user, order }));
  const validUsers = entries.filter(({ user }) => !user.validationErrors?.length);
  const refs = await resolveReferences(
    conn,
    personas,
    validUsers.map(({ user }) => user)
  );
  const existing = await getExistingUsers(
    conn,
    validUsers.map(({ user }) => user),
    {
      defaultExternalIdField: options.externalId ? fieldMap.get(options.externalId.toLowerCase())?.name : undefined,
      defaultFuzzyUsername: options.fuzzyUsername,
      fieldMap,
    }
  );
  const preflight: RelatedPreflightResult = catalog
    ? await runRelatedPreflight({
        conn,
        catalog,
        selected: [...new Set(validUsers.flatMap(({ user }) => user.related ?? []))],
        cache: new Map(),
      })
    : emptyPreflightResult();
  refs.warnings.push(...preflight.warnings);
  const relatedPlansByOrder = catalog
    ? await buildRelatedPlans({
        conn,
        users: validUsers,
        catalog,
        preflight,
        userFieldMap: fieldMap,
      })
    : undefined;
  const plans = buildUserPlans({
    validUsers,
    refs,
    existing,
    fieldMap,
    defaultExternalIdField: options.externalId ? fieldMap.get(options.externalId.toLowerCase())?.name : undefined,
    myDomain: deriveMyDomain(conn.instanceUrl),
    dryRun: false,
    relatedPlansByOrder,
  });
  const previewPlans = buildUserPlans({
    validUsers,
    refs,
    existing,
    fieldMap,
    defaultExternalIdField: options.externalId ? fieldMap.get(options.externalId.toLowerCase())?.name : undefined,
    myDomain: deriveMyDomain(conn.instanceUrl),
    dryRun: true,
    relatedPlansByOrder,
  });
  const licenses = await calculateUserLicenseUsage(conn, plans);
  const validationResults = validationResultsFor(entries.filter(({ user }) => user.validationErrors?.length));
  const planned = await Promise.all(previewPlans.map((plan) => planDryRunResult({ conn, plan, refs })));
  const allPreviewResults = validationResults.concat(planned).sort((left, right) => left.order - right.order);
  const preview = {
    summary: summarize(
      allPreviewResults,
      refs.warnings.length + licenses.filter((license) => license.shortfall > 0).length
    ),
    users: allPreviewResults.map(publicProvisionResult),
    licenses,
    permissionSetLicenses: { evaluated: false, note: 'not evaluated' },
  } as ProvisionResult;
  return { plans, refs: serializeRefs(refs), validationResults, licenses, preview, warnings: refs.warnings };
};

const applyProvisionPlan = async (
  conn: Connection,
  plan: ProvisionPlan,
  ctx?: UseCaseContext
): Promise<ProvisionResult> => {
  startProgress(ctx, 'apply');
  const refs = deserializeRefs(plan.refs);
  checkCancelled(ctx);
  const outcomes = await executeBulkUserSaves(conn, plan.plans, () => checkCancelled(ctx));
  const invalid = plan.plans
    .filter((item) => item.errors.length > 0)
    .map((item) => toUserResult(markRelatedUnapplied(item), 'failed', { includeExistingId: false }));
  const failures = outcomes
    .filter((outcome) => !outcome.success)
    .map((outcome) =>
      toUserResult(markRelatedUnapplied(outcome.plan), 'failed', { errors: outcome.errors, includeExistingId: false })
    );
  const saved = outcomes.filter((outcome) => outcome.success);
  checkCancelled(ctx);
  const related = await applyRelatedPhase(
    conn,
    saved
      .filter((outcome) => outcome.plan.relatedPlans && outcome.id)
      .map((outcome) => ({
        planId: outcome.plan.planId,
        relatedPlans: outcome.plan.relatedPlans as RelatedRecordPlan[],
        savedUserId: outcome.id as string,
      })),
    'after',
    () => checkCancelled(ctx)
  );
  for (const outcome of saved) {
    const results = related.get(outcome.plan.planId);
    if (results) outcome.plan.relatedResults = results;
  }
  const applied: OrderedUserResult[] = [];
  for (const outcome of saved) {
    checkCancelled(ctx);
    // eslint-disable-next-line no-await-in-loop
    const outcomeResult = await applySavedPlan({
      conn,
      outcome,
      refs,
      beforeWrite: () => checkCancelled(ctx),
    });
    applied.push(outcomeResult);
  }
  const users = plan.validationResults
    .concat(invalid, failures, applied)
    .sort((left, right) => left.order - right.order)
    .map(publicProvisionResult);
  endProgress(ctx);
  return {
    summary: summarize(users, plan.warnings.length + plan.licenses.filter((license) => license.shortfall > 0).length),
    users,
  };
};

export const provision: WriteUseCase<ProvisionOptions, ProvisionPlan, ProvisionResult> = {
  kind: 'write',
  descriptor: descriptor('provision', 'Provision', false, provisionOptionsSchema),
  plan: (conn, options, ctx) => runRead(ctx, () => provisionPlan(conn, options, ctx)),
  apply: applyProvisionPlan,
};

type RefResolution = { resolved: Record<string, string>; missing: string[] };
type RestoreUserPlan = {
  userId: string;
  result: LifecycleUserResult;
  preview: LifecycleUserResult;
  userUpdate?: { Id: string; IsActive: true };
  loginUpdates: Array<{ Id: string; IsFrozen: false }>;
  permissionSetAdds: string[];
  permissionSetGroupAdds: string[];
  publicGroupAdds: string[];
  queueAdds: string[];
  licenseAdds: string[];
  permissionSetItems: LabelBundle[];
  permissionSetGroupItems: LabelBundle[];
  publicGroupItems: LabelBundle[];
  queueItems: LabelBundle[];
  licenseItems: LabelBundle[];
};
export type RestorePlan = {
  users: RestoreUserPlan[];
  errors: LifecycleUserResult[];
  warnings: string[];
  preview: LifecycleResult;
};

const identityReview = (snapshotUser: UserSnapshotEntry, target: ResolvedTargetUser): IdentityReview | undefined => {
  const snapshotIdentity = {
    name: snapshotUser.name,
    username: snapshotUser.username,
    email: snapshotUser.email,
    profile: snapshotUser.profile,
    role: snapshotUser.role,
  };
  if (!Object.values(snapshotIdentity).some((value) => value !== undefined)) return undefined;
  return {
    snapshot: Object.fromEntries(Object.entries(snapshotIdentity).filter(([, value]) => value !== undefined)),
    org: {
      ...(target.name !== undefined ? { name: target.name } : {}),
      ...(target.username !== undefined ? { username: target.username } : {}),
      ...(target.email !== undefined ? { email: target.email } : {}),
      ...(target.profile !== undefined ? { profile: target.profile } : {}),
      ...(target.role !== undefined ? { role: target.role } : {}),
      userId: target.Id,
    },
    match: { field: target.field, value: target.value },
  };
};

const identityMismatches = (review: IdentityReview): string[] => {
  const fields = ['name', 'username', 'email', 'profile', 'role'] as const;
  return fields.flatMap((field) => {
    const expected = review.snapshot[field];
    const actual = review.org[field];
    return expected !== undefined && expected !== actual
      ? [`Snapshot ${field} "${expected}" differs from org "${actual ?? '(missing)'}".`]
      : [];
  });
};

const resolveRestoreRefs = async (
  conn: Connection,
  users: UserSnapshotEntry[]
): Promise<Record<string, RefResolution>> => {
  const query = async (table: string, values: string[], name: string, where = ''): Promise<RefResolution> => {
    const unique = [...new Set(values)];
    if (unique.length === 0) return { resolved: {}, missing: [] };
    const rows = (
      await conn.query<{ Id: string } & Record<string, string>>(
        `SELECT Id, ${name} FROM ${table} WHERE ${name} IN (${soqlIn(unique)})${where ? ` AND ${where}` : ''}`
      )
    ).records;
    const resolved = Object.fromEntries(rows.map((row) => [row[name], row.Id]));
    return { resolved, missing: unique.filter((value) => !resolved[value]) };
  };
  return {
    permissionSets: await query(
      'PermissionSet',
      users.flatMap((user) => user.permissionSets),
      'Name'
    ),
    permissionSetGroups: await query(
      'PermissionSetGroup',
      users.flatMap((user) => user.permissionSetGroups),
      'DeveloperName'
    ),
    publicGroups: await query(
      'Group',
      users.flatMap((user) => user.publicGroups),
      'DeveloperName',
      "Type = 'Regular'"
    ),
    queues: await query(
      'Group',
      users.flatMap((user) => user.queues),
      'DeveloperName',
      "Type = 'Queue'"
    ),
    licenses: await query(
      'PermissionSetLicense',
      users.flatMap((user) => user.permissionSetLicenses),
      'DeveloperName'
    ),
  };
};

const ids = (names: string[], refs: RefResolution): string[] =>
  names.map((name) => refs.resolved[name]).filter((id): id is string => Boolean(id));
const missingIds = (wanted: string[], current: Array<string | undefined | null>): string[] => {
  const currentIds = new Set(current.filter((id): id is string => Boolean(id)));
  return wanted.filter((id) => !currentIds.has(id));
};

const makeRestoreUserPlan = (
  state: AssignmentState,
  refs: Awaited<ReturnType<typeof resolveRestoreRefs>>,
  snapshotUser: UserSnapshotEntry,
  target: ResolvedTargetUser
): RestoreUserPlan => {
  const result: LifecycleUserResult = {
    key: target.key,
    id: target.Id,
    name: target.name,
    username: target.username,
    isActive: target.IsActive,
    ...(state.userLoginByUserId.get(target.Id)?.[0]?.IsFrozen === undefined
      ? {}
      : { isFrozen: state.userLoginByUserId.get(target.Id)?.[0]?.IsFrozen }),
    status: 'unchanged',
    actions: [],
    skipped: [],
    warnings: [],
    errors: [],
  };
  const review = identityReview(snapshotUser, target);
  if (review) {
    result.identityReview = review;
    result.warnings.push(...identityMismatches(review));
  }
  const psa = state.psaByUserId.get(target.Id) ?? [];
  const groups = state.groupByUserId.get(target.Id) ?? [];
  const psl = state.pslByUserId.get(target.Id) ?? [];
  const permissionSetAdds = missingIds(
    ids(snapshotUser.permissionSets, refs.permissionSets),
    psa.map((row) => row.PermissionSetId)
  );
  const permissionSetGroupAdds = missingIds(
    ids(snapshotUser.permissionSetGroups, refs.permissionSetGroups),
    psa.map((row) => row.PermissionSetGroupId)
  );
  const publicGroupAdds = missingIds(
    ids(snapshotUser.publicGroups, refs.publicGroups),
    groups.filter((row) => row.Group?.Type === 'Regular').map((row) => row.GroupId)
  );
  const queueAdds = missingIds(
    ids(snapshotUser.queues, refs.queues),
    groups.filter((row) => row.Group?.Type === 'Queue').map((row) => row.GroupId)
  );
  const licenseAdds = missingIds(
    ids(snapshotUser.permissionSetLicenses, refs.licenses),
    psl.map((row) => row.PermissionSetLicenseId)
  );
  const items = (
    names: string[],
    resolution: RefResolution,
    type: LabelBundle['type'],
    wanted: string[]
  ): LabelBundle[] =>
    names.flatMap((name) =>
      resolution.resolved[name] && wanted.includes(resolution.resolved[name])
        ? [{ id: resolution.resolved[name], apiName: name, type }]
        : []
    );
  const loginUpdates = (state.userLoginByUserId.get(target.Id) ?? [])
    .filter((row) => row.IsFrozen)
    .map((row) => ({ Id: row.Id, IsFrozen: false as const }));
  const userUpdate = target.IsActive ? undefined : { Id: target.Id, IsActive: true as const };
  const warnMissing = (table: string, names: string[], resolution: RefResolution): void => {
    for (const name of names) {
      if (resolution.missing.includes(name)) {
        result.warnings.push(provisioningMessage('warningReferenceMissing', [table, name]));
      }
    }
  };
  warnMissing('PermissionSet', snapshotUser.permissionSets, refs.permissionSets);
  warnMissing('PermissionSetGroup', snapshotUser.permissionSetGroups, refs.permissionSetGroups);
  warnMissing('Group', snapshotUser.publicGroups, refs.publicGroups);
  warnMissing('Group', snapshotUser.queues, refs.queues);
  warnMissing('PermissionSetLicense', snapshotUser.permissionSetLicenses, refs.licenses);
  const pendingDml = Boolean(userUpdate) || loginUpdates.length > 0;
  const preview: LifecycleUserResult = { ...result, status: 'unchanged', actions: [] };
  if (userUpdate) preview.actions.push(makeNotice('wouldActivate'));
  if (loginUpdates.length) preview.actions.push(makeNotice('wouldUnfreeze'));
  const action = (key: string, values: string[], entries: LabelBundle[]): void => {
    if (values.length) {
      preview.status = 'planned';
      preview.actions.push(makeNotice(key, values.length, entries));
    }
  };
  if (pendingDml) preview.status = 'planned';
  action(
    'wouldAssignPermissionSet',
    permissionSetAdds,
    items(snapshotUser.permissionSets, refs.permissionSets, 'PermissionSet', permissionSetAdds)
  );
  action(
    'wouldAssignPermissionSetGroup',
    permissionSetGroupAdds,
    items(snapshotUser.permissionSetGroups, refs.permissionSetGroups, 'PermissionSetGroup', permissionSetGroupAdds)
  );
  action(
    'wouldAddPublicGroupMember',
    publicGroupAdds,
    items(snapshotUser.publicGroups, refs.publicGroups, 'PublicGroup', publicGroupAdds)
  );
  action('wouldAddQueueMember', queueAdds, items(snapshotUser.queues, refs.queues, 'Queue', queueAdds));
  action(
    'wouldAssignPermissionSetLicense',
    licenseAdds,
    items(snapshotUser.permissionSetLicenses, refs.licenses, 'PermissionSetLicense', licenseAdds)
  );
  return {
    userId: target.Id,
    result,
    preview,
    ...(userUpdate ? { userUpdate } : {}),
    loginUpdates,
    permissionSetAdds,
    permissionSetGroupAdds,
    publicGroupAdds,
    queueAdds,
    licenseAdds,
    permissionSetItems: items(snapshotUser.permissionSets, refs.permissionSets, 'PermissionSet', permissionSetAdds),
    permissionSetGroupItems: items(
      snapshotUser.permissionSetGroups,
      refs.permissionSetGroups,
      'PermissionSetGroup',
      permissionSetGroupAdds
    ),
    publicGroupItems: items(snapshotUser.publicGroups, refs.publicGroups, 'PublicGroup', publicGroupAdds),
    queueItems: items(snapshotUser.queues, refs.queues, 'Queue', queueAdds),
    licenseItems: items(snapshotUser.permissionSetLicenses, refs.licenses, 'PermissionSetLicense', licenseAdds),
  };
};

const applyRestoreUserPlan = async (conn: Connection, plan: RestoreUserPlan): Promise<void> => {
  const result = plan.result;
  if (plan.userUpdate)
    await runRecordUpdate({ conn, result, sobject: 'User', rows: [plan.userUpdate], actionKey: 'activated' });
  await runRecordUpdate({ conn, result, sobject: 'UserLogin', rows: plan.loginUpdates, actionKey: 'unfrozen' });
  const create = async (
    sobject: 'PermissionSetAssignment' | 'GroupMember' | 'PermissionSetLicenseAssign',
    rows: Array<Record<string, string>>,
    actionKey: string,
    items: LabelBundle[]
  ): Promise<void> => runAssignmentCreates({ conn, result, sobject, rows, actionKey, items });
  await create(
    'PermissionSetAssignment',
    plan.permissionSetAdds.map((id) => ({ AssigneeId: plan.userId, PermissionSetId: id })),
    'assignedPermissionSet',
    plan.permissionSetItems
  );
  await create(
    'PermissionSetAssignment',
    plan.permissionSetGroupAdds.map((id) => ({ AssigneeId: plan.userId, PermissionSetGroupId: id })),
    'assignedPermissionSetGroup',
    plan.permissionSetGroupItems
  );
  await create(
    'GroupMember',
    plan.publicGroupAdds.map((id) => ({ GroupId: id, UserOrGroupId: plan.userId })),
    'addedPublicGroupMember',
    plan.publicGroupItems
  );
  await create(
    'GroupMember',
    plan.queueAdds.map((id) => ({ GroupId: id, UserOrGroupId: plan.userId })),
    'addedQueueMember',
    plan.queueItems
  );
  await create(
    'PermissionSetLicenseAssign',
    plan.licenseAdds.map((id) => ({ AssigneeId: plan.userId, PermissionSetLicenseId: id })),
    'assignedPermissionSetLicense',
    plan.licenseItems
  );
};

const restorePlan = async (conn: Connection, options: RestoreOptions, ctx?: UseCaseContext): Promise<RestorePlan> => {
  checkCancelled(ctx);
  const snapshotFile = options.snapshotDoc
    ? parseSnapshot(options.snapshotDoc)
    : options.snapshotPath
    ? await (await import('./lifecycle/snapshotState.js')).readSnapshotFile(options.snapshotPath)
    : undefined;
  if (!snapshotFile) throw new Error('A snapshot document or path is required.');
  const fieldMap = await describeUserFields(conn);
  const requests: TargetRequest[] = [];
  const errors: LifecycleUserResult[] = [];
  for (const [order, user] of snapshotFile.users.entries()) {
    const field = resolveTargetField(user.match, fieldMap);
    if (!field)
      errors.push({
        key: `${user.match}:${user.matchValue}`,
        status: 'failed',
        actions: [],
        skipped: [],
        warnings: [],
        errors: [lifecycleMessage('errorInvalidUserMatchField', [user.match])],
      });
    else requests.push({ key: `${field}:${user.matchValue}`, field, value: user.matchValue, order });
  }
  const resolved = await resolveTargets(conn, requests, fieldMap);
  errors.push(...resolved.errors.map(failedResult));
  const [state, refs] = await Promise.all([
    loadAssignmentState(
      conn,
      resolved.targets.map((target) => target.Id)
    ),
    resolveRestoreRefs(conn, snapshotFile.users),
  ]);
  const plans = resolved.targets.map((target) =>
    makeRestoreUserPlan(state, refs, snapshotFile.users[target.order], target)
  );
  const warnings = plans.flatMap((plan) => plan.preview.warnings);
  const previewUsers = errors.concat(plans.map((plan) => plan.preview));
  return {
    users: plans,
    errors,
    warnings,
    preview: { summary: summarizeLifecycle(previewUsers), users: previewUsers },
  };
};

export const restore: WriteUseCase<RestoreOptions, RestorePlan, LifecycleResult> = {
  kind: 'write',
  descriptor: descriptor('restore', 'Restore', false, restoreOptionsSchema),
  plan: (conn, options, ctx) => runRead(ctx, () => restorePlan(conn, options, ctx)),
  apply: async (conn, plan, ctx) => {
    startProgress(ctx, 'apply');
    for (const user of plan.users) {
      checkCancelled(ctx);
      // eslint-disable-next-line no-await-in-loop
      await applyRestoreUserPlan(conn, user);
    }
    const users = plan.errors.concat(plan.users.map((user) => user.result));
    endProgress(ctx);
    return { summary: summarizeLifecycle(users), users };
  },
};

export const commandDescriptors = [
  provision.descriptor,
  access.descriptor,
  diff.descriptor,
  freeze.descriptor,
  unfreeze.descriptor,
  strip.descriptor,
  snapshot.descriptor,
  restore.descriptor,
] as const;

export type {
  ProvisionOptions,
  FreezeOptions,
  UnfreezeOptions,
  StripOptions,
  DiffOptions,
  AccessOptions,
  SnapshotOptions,
  RestoreOptions,
};
