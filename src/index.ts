// Everything exported from this file is warden-core's public API and is
// semver-covered: adding an export is a minor change, but removing or renaming
// one, or changing a signature or result shape, is breaking.
// `test/index.test.ts` pins the exported-key list so an accidental removal
// fails a test instead of shipping. See docs/design/0001-warden-core-boundaries.md.

export { WardenError, isWardenError } from './errors.js';

export { AccessError, UserAccessError } from './access/types.js';
export {
  flattenAccessRow,
  renderAccessResult,
  renderEnabledTable,
  renderFieldTable,
  renderObjectTable,
  renderRecordTypeTable,
  renderTabTable,
} from './access/output.js';
export { getResolver } from './access/resolvers/index.js';
export { resolveReverseAccess, reverseCsvColumns } from './access/reverse.js';

export { LifecycleError } from './lifecycle/errors.js';
export { FREEZE, UNFREEZE } from './lifecycle/freezeState.js';
export {
  failedResult,
  makeNotice,
  renderLifecycleResult,
  resolvedTargetResult,
  summarizeLifecycle,
} from './lifecycle/output.js';
export { buildSnapshotFile, readSnapshotFile, writeSnapshotFile } from './lifecycle/snapshotState.js';
export { snapshotToLifecycleResult } from './lifecycle/snapshotOutput.js';
export { buildTargetRequests, parseUserFlag, resolveTargetField, resolveTargets } from './lifecycle/targeting.js';
export { executePersonaDiff, executeUserToUserDiff } from './lifecycle/userDiff.js';
export { renderUserDiffCsv, renderUserDiffHuman } from './lifecycle/diffOutput.js';
export { renderUserConformanceCsv, renderUserConformanceHuman, verifyUserDiff } from './lifecycle/conformance.js';
export { loadAssignmentState } from './lifecycle/assignmentState.js';
export { runAssignmentCreates, runRecordUpdate } from './lifecycle/dmlRunner.js';

export { ProvisioningError, DefinitionError } from './provisioning/errors.js';
export { ProvisionUserUseCase } from './provisioning/provisionUserUseCase.js';
export { readProvisionDefinitions } from './provisioning/definitionReader.js';
export { renderProvisionHuman } from './provisioning/output.js';
export { renderMessages, renderMessagesFor } from './renderMessages.js';

export { RelatedRecordsError } from './relatedRecords/errors.js';

export {
  personaDefinitionsFileSchema,
  personaSchema,
  relatedCatalogSchema,
  relationshipDefSchema,
  snapshotFileSchema,
  userInputSchema,
  userSnapshotEntrySchema,
  usersDefinitionFileSchema,
  USERS_CSV_COLUMNS,
} from './spec/index.js';
export {
  parsePersonaDefinitions,
  parseRelatedCatalog,
  parseSnapshot,
  parseUsersDefinition,
  safeParsePersonaDefinitions,
  safeParseRelatedCatalog,
  safeParseSnapshot,
  safeParseUsersDefinition,
  validatePersonaDefinitionsText,
  validateRelatedCatalogText,
  validateSnapshotText,
  validateUsersDefinitionText,
} from './spec/index.js';

export { detectInputFormat, serializeCsv } from './shared/csv.js';
export { describeUserFields } from './shared/userFields.js';
export {
  renderLifecycleCsv,
  renderProvisionCsv,
  renderRestoreCsv,
  renderSnapshotCsv,
  renderStripCsv,
} from './shared/output.js';
export { soqlIn } from './shared/sfUtils.js';

export { access, commandDescriptors, diff, freeze, provision, restore, snapshot, strip, unfreeze } from './useCases.js';
export {
  accessOptionsSchema,
  diffOptionsSchema,
  freezeOptionsSchema,
  provisionOptionsSchema,
  restoreOptionsSchema,
  snapshotOptionsSchema,
  stripOptionsSchema,
  unfreezeOptionsSchema,
} from './commandOptions.js';
export { uiHints } from './useCase.js';
export { planFromState } from './provisioning/conformancePlan.js';
export {
  conformanceCategorySchema,
  conformanceDefinitionsSchema,
  conformanceFixtureSchema,
  conformanceOrgStateSchema,
  conformancePlanRowSchema,
  conformanceUsersDefinitionSchema,
  parseConformanceFixture,
  safeParseConformanceFixture,
  validateConformanceFixtureText,
} from './spec/index.js';

export type { InputFormat } from './shared/csv.js';
export type {
  AccessOptions,
  DiffOptions,
  FreezeOptions,
  ProvisionOptions,
  RestoreOptions,
  SnapshotOptions,
  StripOptions,
  UnfreezeOptions,
} from './commandOptions.js';
export type {
  CommandDescriptor,
  ProgressEvent,
  ReadUseCase,
  UiHint,
  UseCase,
  UseCaseContext,
  WriteUseCase,
} from './useCase.js';
export type { FreezePlan, ProvisionPlan, RestorePlan, StripPlan } from './useCases.js';
export type { AccessTargetType, UserAccessResult, UserAccessRow, ValidatedAccessTarget } from './access/types.js';
export type { AssignmentState } from './lifecycle/assignmentState.js';
export type {
  IdentityReview,
  LabelBundle,
  LifecycleResult,
  LifecycleUserResult,
  ResolvedTargetUser,
  TargetRequest,
} from './lifecycle/types.js';
export type { ProvisionResult } from './provisioning/provisionUserUseCase.js';
export type { StripFlags } from './lifecycle/stripPlan.js';
export type { UserDiffResult } from './lifecycle/userDiff.js';
export type { MessageLookup } from './lifecycle/diffOutput.js';
export type { UserConformanceVerdict } from './lifecycle/conformance.js';
export type { UserSnapshotEntry } from './lifecycle/snapshotState.js';
export type {
  ConformanceCategory,
  ConformanceDefinitions,
  ConformanceFixture,
  ConformanceOrgState,
  ConformancePlanRow,
} from './spec/index.js';
export type {
  PersonaDefinition,
  PersonaDefinitionsFile,
  RelatedCatalog,
  RelationshipDef,
  RelationshipMode,
  RelationshipPhase,
  SchemaFailure,
  SchemaIssue,
  SchemaResult,
  SchemaSuccess,
  SourceExpr,
  UserInput,
  UserSnapshotFile,
  UsersDefinitionFile,
} from './spec/index.js';
