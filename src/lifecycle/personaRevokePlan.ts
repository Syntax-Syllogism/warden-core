import type { ResolvedRefs } from '../provisioning/assignmentPlan.js';
import type { RevocationPlanRow } from '../spec/conformanceFixture.js';
import type { PersonaDefinition } from '../spec/personaDefinitions.js';
import type { GroupMemberRow, PermissionSetAssignmentRow } from './assignmentState.js';
import { groupMemberLabel, permissionSetAssignmentLabel } from './assignmentState.js';
import type { LabelBundle } from './types.js';
import type { StripFlags, StripStep } from './stripPlan.js';

export type PersonaRevocationCategory = RevocationPlanRow['category'];

export type PersonaRevocationInput = {
  userKey: string;
  userId: string;
  personas: Record<string, PersonaDefinition>;
  heldPersonas: string[];
  removePersonas: string[] | 'all';
  refs: ResolvedRefs;
  assignmentRows: PermissionSetAssignmentRow[];
  membershipRows: GroupMemberRow[];
  flags?: StripFlags;
  /** Optional ledger targets grouped by removed persona. Supplying it enables unmanaged-grant warnings. */
  ledgerTargets?: ReadonlyMap<string, ReadonlySet<string>>;
};

export type PersonaRevocationPlan = {
  rows: RevocationPlanRow[];
  steps: StripStep[];
  warnings: string[];
  removedTargets: Set<string>;
};

const categoryOrder: PersonaRevocationCategory[] = ['PermissionSet', 'PermissionSetGroup', 'PublicGroup', 'Queue'];

const listKey: Record<PersonaRevocationCategory, keyof PersonaDefinition> = {
  PermissionSet: 'permissionSets',
  PermissionSetGroup: 'permissionSetGroups',
  PublicGroup: 'publicGroups',
  Queue: 'queues',
};

const referenceMap = (refs: ResolvedRefs, category: PersonaRevocationCategory): Map<string, string> => {
  if (category === 'PermissionSet') return refs.permissionSetIdsByRef;
  if (category === 'PermissionSetGroup') return refs.permissionSetGroupIdsByRef;
  if (category === 'PublicGroup') return refs.publicGroupIdsByRef;
  return refs.queueIdsByRef;
};

const categoryFlags: Record<PersonaRevocationCategory, string> = {
  PermissionSet: 'keep-permsets',
  PermissionSetGroup: 'keep-permset-groups',
  PublicGroup: 'keep-public-groups',
  Queue: 'keep-queues',
};

const compareText = (left: string, right: string): number => (left === right ? 0 : left < right ? -1 : 1);

const targetLabel = (refs: ResolvedRefs, id: string): LabelBundle => refs.labels?.[id] ?? { id, apiName: id };

const detailFor = (refs: ResolvedRefs, id: string): string => {
  const label = targetLabel(refs, id);
  return label.label ?? label.apiName ?? label.id;
};

const assignmentIds = (
  category: PersonaRevocationCategory,
  targetId: string,
  assignments: PermissionSetAssignmentRow[],
  memberships: GroupMemberRow[]
): { ids: string[]; items: LabelBundle[] } => {
  if (category === 'PermissionSet') {
    const rows = assignments.filter(
      (row) =>
        row.PermissionSetGroupId == null &&
        row.PermissionSetId === targetId &&
        row.PermissionSet?.IsOwnedByProfile !== true
    );
    return {
      ids: rows.map((row) => row.Id),
      items: rows.flatMap((row) => {
        const item = permissionSetAssignmentLabel(row);
        return item ? [item] : [];
      }),
    };
  }
  if (category === 'PermissionSetGroup') {
    const rows = assignments.filter((row) => row.PermissionSetGroupId === targetId);
    return {
      ids: rows.map((row) => row.Id),
      items: rows.flatMap((row) => {
        const item = permissionSetAssignmentLabel(row);
        return item ? [item] : [];
      }),
    };
  }
  const groupType = category === 'Queue' ? 'Queue' : 'Regular';
  const rows = memberships.filter((row) => row.GroupId === targetId && row.Group?.Type === groupType);
  return { ids: rows.map((row) => row.Id), items: rows.map(groupMemberLabel) };
};

const hasFlag = (flags: StripFlags | undefined, key: string): boolean => flags?.[key] === true;

const row = (
  userKey: string,
  userId: string,
  category: PersonaRevocationCategory,
  action: RevocationPlanRow['action'],
  status: RevocationPlanRow['status'],
  detail: string,
  error = ''
): RevocationPlanRow => ({ userKey, userId, category, action, status, detail, error });

const collectTargets = (
  names: string[],
  personas: Record<string, PersonaDefinition>,
  category: PersonaRevocationCategory,
  refs: ResolvedRefs
): { resolved: Map<string, string[]>; unresolved: string[] } => {
  const resolved = new Map<string, string[]>();
  const unresolved: string[] = [];
  const byRef = referenceMap(refs, category);
  for (const name of names) {
    const definition = personas[name];
    if (!definition) {
      continue;
    }
    for (const reference of (definition[listKey[category]] as string[] | undefined) ?? []) {
      const targetId = byRef.get(reference);
      if (!targetId) unresolved.push(reference);
      else resolved.set(targetId, [...(resolved.get(targetId) ?? []), name]);
    }
  }
  return { resolved, unresolved: [...new Set(unresolved)] };
};

const keptBy = (
  id: string,
  names: string[],
  personas: Record<string, PersonaDefinition>,
  category: PersonaRevocationCategory,
  refs: ResolvedRefs
): string[] => {
  const byRef = referenceMap(refs, category);
  return names.filter((name) => {
    const definition = personas[name];
    return ((definition?.[listKey[category]] as string[] | undefined) ?? []).some(
      (reference) => byRef.get(reference) === id
    );
  });
};

const sortRows = (left: RevocationPlanRow, right: RevocationPlanRow): number =>
  compareText(left.userKey, right.userKey) ||
  categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
  compareText(left.detail, right.detail) ||
  compareText(left.action, right.action);

const addUnmanagedWarnings = (
  warnings: string[],
  ledgerTargets: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  grantingNames: string[],
  targetId: string,
  detail: string,
  userKey: string
): void => {
  if (!ledgerTargets) return;
  for (const name of grantingNames) {
    if (!ledgerTargets.get(name)?.has(targetId)) warnings.push(`removedUnmanagedGrant: ${detail} for ${userKey}.`);
  }
};

/**
 * Plan persona-scoped access removal from plain definitions, resolved references,
 * and direct assignment rows. This function performs no Salesforce I/O.
 */
export const planPersonaRevocation = (input: PersonaRevocationInput): PersonaRevocationPlan => {
  const { userKey, userId, personas, heldPersonas, removePersonas, refs, assignmentRows, membershipRows, flags } =
    input;
  const requested = removePersonas === 'all' ? [...heldPersonas] : removePersonas;
  const removedNames = new Set(requested.filter((name) => heldPersonas.includes(name)));
  const keptNames = heldPersonas.filter((name) => !removedNames.has(name));
  const rows: RevocationPlanRow[] = [];
  const stepsByCategory = new Map<PersonaRevocationCategory, StripStep>();
  const warnings: string[] = [];
  const removedTargets = new Set<string>();

  const missingRemovedNames = [...removedNames].filter((name) => !personas[name]);
  const missingKeptNames = keptNames.filter((name) => !personas[name]);

  for (const name of [...missingRemovedNames, ...missingKeptNames]) {
    if (!personas[name]) {
      rows.push(
        row(
          userKey,
          userId,
          'PermissionSet',
          'unresolved',
          'unmanaged',
          name,
          `Unresolved ${missingKeptNames.includes(name) ? 'retained ' : ''}persona definition "${name}".`
        )
      );
    }
  }

  for (const category of categoryOrder) {
    const removed = collectTargets([...removedNames], personas, category, refs);
    const unresolvedRows = removed.unresolved.map((reference) =>
      row(
        userKey,
        userId,
        category,
        'unresolved',
        'unmanaged',
        reference,
        `Unresolved ${category} reference "${reference}".`
      )
    );
    rows.push(...unresolvedRows);

    // An unknown retained persona may grant any target. Do not remove access
    // until its definition is available to evaluate the keep rule.
    if (missingKeptNames.length > 0) continue;

    for (const [targetId, grantingNames] of removed.resolved.entries()) {
      const detail = detailFor(refs, targetId);
      const coveringNames = keptBy(targetId, keptNames, personas, category, refs);
      const holdings = assignmentIds(category, targetId, assignmentRows, membershipRows);
      if (coveringNames.length > 0) {
        rows.push(
          row(
            userKey,
            userId,
            category,
            'keptByOtherPersona',
            'kept',
            `${detail} (kept by ${coveringNames.sort(compareText).join(', ')})`
          )
        );
        continue;
      }
      if (holdings.ids.length === 0) {
        rows.push(row(userKey, userId, category, 'alreadyAbsent', 'unchanged', detail));
        continue;
      }
      rows.push(row(userKey, userId, category, 'wouldRemove', 'planned', detail));
      if (hasFlag(flags, categoryFlags[category])) continue;
      removedTargets.add(targetId);
      addUnmanagedWarnings(warnings, input.ledgerTargets, grantingNames, targetId, detail, userKey);
      if (hasFlag(flags, 'dry-run')) continue;
      const existing = stepsByCategory.get(category);
      if (existing && existing.kind === 'delete') {
        existing.ids.push(...holdings.ids);
        existing.items.push(...holdings.items);
      } else {
        const actionKey =
          category === 'PermissionSet'
            ? 'removedPermissionSet'
            : category === 'PermissionSetGroup'
            ? 'removedPermissionSetGroup'
            : category === 'PublicGroup'
            ? 'removedPublicGroupMember'
            : 'removedQueueMember';
        const sobject = category === 'PublicGroup' || category === 'Queue' ? 'GroupMember' : 'PermissionSetAssignment';
        stepsByCategory.set(category, {
          kind: 'delete',
          sobject,
          ids: [...holdings.ids],
          actionKey,
          items: [...holdings.items],
        });
      }
    }
  }

  return {
    rows: rows.sort(sortRows),
    steps: categoryOrder.flatMap((category) => {
      const step = stepsByCategory.get(category);
      return step ? [step] : [];
    }),
    warnings,
    removedTargets,
  };
};
