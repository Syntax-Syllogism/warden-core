import type { GroupMemberRow, PermissionSetAssignmentRow } from '../lifecycle/assignmentState.js';
import type {
  ConformanceCategory,
  ConformanceDefinitions,
  ConformanceOrgState,
  ConformancePlanRow,
} from '../spec/conformanceFixture.js';
import { computeAssignmentDeltaFromState, type ResolvedRefs } from './assignmentPlan.js';
import { mergePersonas, type PersonaDefinition } from './planner.js';

type Reference = { id: string; name?: string; developerName?: string; label?: string };

const categoryOrder: ConformanceCategory[] = ['PermissionSet', 'PermissionSetGroup', 'PublicGroup', 'Queue'];

const compareText = (left: string, right: string): number => (left === right ? 0 : left < right ? -1 : 1);

const categoryListKey: Record<ConformanceCategory, keyof PersonaDefinition> = {
  PermissionSet: 'permissionSets',
  PermissionSetGroup: 'permissionSetGroups',
  PublicGroup: 'publicGroups',
  Queue: 'queues',
};

const categoryReferenceKey: Record<ConformanceCategory, 'name' | 'developerName'> = {
  PermissionSet: 'name',
  PermissionSetGroup: 'developerName',
  PublicGroup: 'developerName',
  Queue: 'developerName',
};

const referenceLabel = (reference: Reference): string =>
  reference.label ?? reference.developerName ?? reference.name ?? reference.id;

const addReference = (map: Map<string, string>, reference: Reference, lookupKey: 'name' | 'developerName'): string => {
  map.set(reference.id, reference.id);
  const key = reference[lookupKey];
  if (key) map.set(key, reference.id);
  return referenceLabel(reference);
};

const referencesFor = (
  state: ConformanceOrgState
): {
  refs: ResolvedRefs;
  labels: Record<string, string>;
} => {
  const labels: Record<string, string> = {};
  const refs: ResolvedRefs = {
    profilesByRef: new Map(),
    rolesByRef: new Map(),
    permissionSetIdsByRef: new Map(),
    permissionSetGroupIdsByRef: new Map(),
    publicGroupIdsByRef: new Map(),
    queueIdsByRef: new Map(),
    warnings: [],
  };
  for (const reference of state.permissionSets) {
    labels[reference.id] = addReference(refs.permissionSetIdsByRef, reference, categoryReferenceKey.PermissionSet);
  }
  for (const reference of state.permissionSetGroups)
    labels[reference.id] = addReference(
      refs.permissionSetGroupIdsByRef,
      reference,
      categoryReferenceKey.PermissionSetGroup
    );
  for (const reference of state.groups) {
    const targetMap = reference.type === 'Queue' ? refs.queueIdsByRef : refs.publicGroupIdsByRef;
    const category = reference.type === 'Queue' ? 'Queue' : 'PublicGroup';
    labels[reference.id] = addReference(targetMap, reference, categoryReferenceKey[category]);
  }
  return { refs, labels };
};

const assignmentRowsForUser = (state: ConformanceOrgState, userId: string): PermissionSetAssignmentRow[] =>
  state.permissionSetAssignments
    .filter((row) => row.userId === userId)
    .map((row) => ({
      Id: row.id,
      AssigneeId: row.userId,
      PermissionSetId: row.permissionSetId,
      PermissionSetGroupId: row.permissionSetGroupId,
      PermissionSet: { IsOwnedByProfile: false },
    }));

const groupMembersForUser = (state: ConformanceOrgState, userId: string): GroupMemberRow[] =>
  state.groupMembers
    .filter((row) => row.userId === userId)
    .map((row) => {
      const group = state.groups.find((candidate) => candidate.id === row.groupId);
      return {
        Id: row.id,
        GroupId: row.groupId,
        UserOrGroupId: row.userId,
        Group: group ? { Type: group.type, DeveloperName: group.developerName, Name: group.name } : undefined,
      };
    });

const rowForUnresolved = (
  userKey: string,
  userId: string,
  category: ConformanceCategory,
  reference: string
): ConformancePlanRow => ({
  userKey,
  userId,
  category,
  action: 'unresolved',
  status: 'unmanaged',
  detail: reference,
  error: `Unresolved ${category} reference "${reference}".`,
});

const plannedRowsForCategory = (
  userKey: string,
  userId: string,
  category: ConformanceCategory,
  persona: PersonaDefinition,
  refs: ResolvedRefs,
  labels: Record<string, string>,
  assignmentRows: PermissionSetAssignmentRow[],
  membershipRows: GroupMemberRow[]
): ConformancePlanRow[] => {
  const references = (persona[categoryListKey[category]] as string[] | undefined) ?? [];
  const referenceMap =
    category === 'PermissionSet'
      ? refs.permissionSetIdsByRef
      : category === 'PermissionSetGroup'
      ? refs.permissionSetGroupIdsByRef
      : category === 'PublicGroup'
      ? refs.publicGroupIdsByRef
      : refs.queueIdsByRef;
  const unresolved = references
    .filter((reference) => !referenceMap.has(reference))
    .map((reference) => rowForUnresolved(userKey, userId, category, reference));
  const delta = computeAssignmentDeltaFromState(persona, refs, assignmentRows, membershipRows);
  const adds = delta[categoryListKey[category] as keyof typeof delta].adds;
  return unresolved.concat(
    adds.map((id) => ({
      userKey,
      userId,
      category,
      action: 'wouldAssign' as const,
      status: 'planned' as const,
      detail: labels[id] ?? id,
      error: '',
    }))
  );
};

const sortRows = (left: ConformancePlanRow, right: ConformancePlanRow): number =>
  compareText(left.userKey, right.userKey) ||
  categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
  compareText(left.detail, right.detail) ||
  compareText(left.action, right.action);

/**
 * Compute the v1 additive reconciliation plan without a Salesforce connection.
 * References are resolved from the fixture's simulated setup-object catalogs;
 * existing assignments and memberships are used only for the current user.
 */
export const planFromState = (
  definitions: ConformanceDefinitions,
  orgState: ConformanceOrgState
): ConformancePlanRow[] => {
  const { refs, labels } = referencesFor(orgState);
  const rows: ConformancePlanRow[] = [];
  for (const user of definitions.users.users) {
    const { effective, errors } = mergePersonas(user.personas ?? [], definitions.personas.personas, {}, new Map());
    if (errors.length > 0) {
      rows.push({
        userKey: user.userKey,
        userId: user.userId,
        category: 'PermissionSet',
        action: 'unresolved',
        status: 'unmanaged',
        detail: errors.map((error) => error.code).join(', '),
        error: 'Unable to merge persona definitions.',
      });
      continue;
    }
    const assignmentRows = assignmentRowsForUser(orgState, user.userId);
    const membershipRows = groupMembersForUser(orgState, user.userId);
    for (const category of categoryOrder) {
      rows.push(
        ...plannedRowsForCategory(
          user.userKey,
          user.userId,
          category,
          effective,
          refs,
          labels,
          assignmentRows,
          membershipRows
        )
      );
    }
  }
  return rows.sort(sortRows);
};
