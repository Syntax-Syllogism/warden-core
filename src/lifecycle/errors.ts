import { WardenError } from '../errors.js';

export type LifecycleErrorCode =
  | 'errorInvalidJson'
  | 'errorInvalidUserMatchField'
  | 'errorInvalidUserValue'
  | 'errorInvalidAgainstValue'
  | 'errorInvalidAgainstMatchField'
  | 'errorInvalidSnapshot'
  | 'errorPromptDeclined'
  | 'errorAccessScopesMutuallyExclusive'
  | 'errorVerifyUserMode';

export class LifecycleError extends WardenError<LifecycleErrorCode> {
  public constructor(code: LifecycleErrorCode, message: string, data?: unknown) {
    super(code, message, data);
    this.name = 'LifecycleError';
  }
}
