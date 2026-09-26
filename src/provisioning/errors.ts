import { WardenError } from '../errors.js';

export type ProvisioningErrorCode =
  | 'errorDuplicateExternalIdMatch'
  | 'errorMissingRequiredFields'
  | 'errorMissingSaveId'
  | 'errorPromptDeclined'
  | 'errorInvalidJson'
  | 'errorInvalidPersonaDefinition'
  | 'errorPersonasWithoutDefinition';

export class ProvisioningError extends WardenError<ProvisioningErrorCode> {
  public constructor(code: ProvisioningErrorCode, message: string, data?: unknown) {
    super(code, message, data);
    this.name = 'ProvisioningError';
  }
}

export type DefinitionErrorCode =
  | 'errorInvalidCsv'
  | 'errorInvalidJson'
  | 'errorInvalidPersonaDefinition'
  | 'errorMissingUserFieldMap'
  | 'errorPersonasWithoutDefinition'
  | 'schema-invalid'
  | 'schema-version-unsupported';

export class DefinitionError extends WardenError<DefinitionErrorCode> {
  public constructor(code: DefinitionErrorCode, message: string, data?: unknown) {
    super(code, message, data);
    this.name = 'DefinitionError';
  }
}
