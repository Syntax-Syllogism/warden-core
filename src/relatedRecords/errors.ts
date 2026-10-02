import { WardenError } from '../errors.js';

export type RelatedRecordsErrorCode =
  | 'errorInvalidRelatedCatalog'
  | 'errorRelationshipInvalidDefinition'
  | 'errorRelationshipInvalidSobject'
  | 'errorRelationshipMissingPhase'
  | 'errorRelationshipInvalidPhase'
  | 'errorPhaseBeforeUnsupported'
  | 'errorLinkUserUnsupported'
  | 'errorRelationshipInvalidLinkUser'
  | 'errorRelatedContextUnsupported'
  | 'errorRelationshipInvalidMatch'
  | 'errorRelationshipMatchFromUserId'
  | 'errorRelationshipInvalidFields'
  | 'errorRelationshipInvalidSource'
  | 'errorRelationshipInvalidFrom'
  | 'errorRelationshipUnknownUserField'
  | 'errorRelationshipUnwritableField'
  | 'errorRelationshipInvalidMode'
  | 'errorRelationshipInvalidRecordType';

export class RelatedRecordsError extends WardenError<RelatedRecordsErrorCode> {
  public constructor(code: RelatedRecordsErrorCode, message: string, data?: unknown) {
    super(code, message, data);
    this.name = 'RelatedRecordsError';
  }
}
