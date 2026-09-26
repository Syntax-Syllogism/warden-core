const TEXT: Record<string, string> = {
  errorInvalidJson: 'Failed to parse JSON file %s: %s',
  errorInvalidPersonaDefinition: 'persona-def.json must contain a personas object.',
  promptWarningsContinue: 'Validation warnings were found. Continue?',
  errorPromptDeclined: 'Provisioning cancelled because warnings were not confirmed.',
  warningPromptTimeout: 'Warning confirmation timed out after 10 seconds.',
  warningReferenceMissing: '%s reference "%s" was not found.',
  errorFieldNotWritable: 'Field %s is not %s.',
  errorReferenceRequiredMissing: 'Required %s reference "%s" was not found.',
  errorDuplicateExternalIdMatch: 'Multiple users matched %s="%s".',
  errorInvalidUserMatchField: 'match must name a valid filterable User field: %s.',
  errorInvalidFuzzyUsername: 'fuzzyUsername must be a boolean. Got: %s.',
  errorUserMatchFieldEmpty: 'match field %s must be populated on the user.',
  errorMissingRequiredFields: 'Missing required fields for insert: %s.',
  errorMissingSaveId: 'Save operation returned no user id.',
  errorCrossReferenceCandidates: 'Cross-reference update candidates for this user: %s',
  errorNoPersonas: 'Each user must include a non-empty personas array.',
  errorPersonasWithoutDefinition: 'User "%s" lists personas but no --personas-def was supplied.',
  errorLegacyPersonaKey: '"persona" is no longer supported; use "personas": [ ... ].',
  errorUnknownPersona: 'Unknown persona "%s".',
  errorPersonaConflictProfile: 'Personas conflict on profile: %s.',
  errorPersonaConflictRole: 'Personas conflict on role: %s.',
  errorPersonaConflictUserAttribute: 'Personas conflict on userAttribute "%s".',
  errorPersonaConflictMode: 'Personas conflict on %s.',
  errorUserProfileConflict: 'Set either "profile" or "ProfileId" on a user, not both.',
  errorUserRoleConflict: 'Set either "role" or "UserRoleId" on a user, not both.',
  errorInvalidUserProfile: 'user "profile" must be a string (a profile name or Id). Got: %s',
  errorInvalidUserRole: 'user "role" must be a string (a role name/DeveloperName or Id). Got: %s',
  errorRelatedRequiresJson:
    '--related-def requires a JSON --users-def. CSV user definitions cannot select relationships.',
  errorInvalidRelatedCatalog: 'related-def.json must contain a relationships object.',
  errorRelationshipInvalidDefinition: 'Relationship "%s" must be an object.',
  errorRelationshipInvalidSobject: 'Relationship "%s" must declare a non-empty "sobject".',
  errorRelationshipMissingPhase: 'Relationship "%s" must declare "phase". The only supported value is "after".',
  errorRelationshipInvalidPhase: 'Relationship "%s" has an invalid phase "%s". The only supported value is "after".',
  errorPhaseBeforeUnsupported:
    'Relationship "%s" uses phase "before". Before-phase relationships are not supported in this release; they ship with related-record provisioning v2.',
  errorLinkUserUnsupported:
    'Relationship "%s" uses "linkUser". Writing a value back onto the User is not supported in this release; it ships with related-record provisioning v2.',
  errorRelatedContextUnsupported:
    'Relationship "%s" field "%s" uses a "context." source. Related-context sources are not supported in this release; they ship with related-record provisioning v2.',
  errorRelationshipInvalidMatch: 'Relationship "%s" must declare "match" with non-empty "field" and "from" strings.',
  errorRelationshipMatchFromUserId:
    'Relationship "%s" cannot match on "user.Id" because matching runs before the User is saved.',
  errorRelationshipInvalidFields: 'Relationship "%s" must declare a non-empty "fields" object.',
  errorRelationshipInvalidSource: 'Relationship "%s" field "%s" must declare exactly one of "from" or "value".',
  errorRelationshipInvalidFrom:
    'Relationship "%s" field "%s" has an invalid source "%s". Expected "user.<Field>" or "user.Id".',
  errorRelationshipUnknownUserField: 'Relationship "%s" field "%s" references unknown User field "%s".',
  errorRelationshipUnwritableField: 'Relationship "%s" cannot write "%s"; the field is not writable.',
  errorRelationshipInvalidMode: 'Relationship "%s" has an invalid mode "%s". Expected setIfEmpty or sync.',
  errorRelationshipInvalidRecordType: 'Relationship "%s" recordType must declare a non-empty "developerName".',
  errorRelatedSobjectUnavailable: 'sObject %s could not be described.',
  errorRelatedSobjectNotQueryable: 'sObject %s is not queryable.',
  errorRelatedUnknownFields: '%s is missing configured fields: %s.',
  errorRelatedMatchFieldNotUnique: 'Match field %s on %s must be filterable and either an External ID or Unique.',
  errorRelatedFieldsNotReadable: 'Related fields on %s are not readable and cannot be inspected: %s.',
  errorRelatedFieldsNotWritable: '%s configured fields are neither createable nor updateable: %s.',
  errorRelatedFieldsNotWritableForOperation: 'Related fields on %s are not %s for this planned write: %s.',
  errorRelatedRecordTypeUnavailable: 'Record type "%s" is not available on %s.',
  errorRelatedPersonAccountRecordTypeRequired:
    'An Account relationship must declare an available Person Account record type.',
  warningRelationshipSkipped: 'Relationship "%s" will be skipped: %s',
  errorInvalidRelatedKey: 'related must be an array of relationship names. Got: %s.',
  errorUnknownRelationship: 'Unknown relationship "%s".',
  errorDuplicateRelationshipSelection: 'Relationship "%s" is listed more than once.',
  errorRelatedWithoutCatalog: 'related was supplied but no --related-def catalog was provided.',
  errorRelatedSourceEmpty: 'Relationship "%s" field "%s" resolved to an empty value from User.%s.',
  errorRelatedInvalidSourceValue: 'Relationship "%s" field "%s" has an unresolvable source "%s".',
  errorAmbiguousRelatedMatch: 'Relationship "%s" matched multiple %s records on %s="%s".',
  errorRelatedMatchCollision: 'Relationship "%s" resolves to %s="%s" for more than one user.',
  errorRelatedRecordTypeMismatch:
    'Relationship "%s" matched an existing %s record whose record type is not "%s"; warden never retags an existing record.',
};

export type ProvisioningMessageCode = keyof typeof TEXT;

export const provisioningMessage = (code: string, args: string[] = []): string => {
  const template = TEXT[code] ?? code;
  let index = 0;
  return template.replaceAll('%s', () => args[index++] ?? '');
};
