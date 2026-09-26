/**
 * Base error for everything warden-core throws on purpose.
 *
 * `code` and the shape of `data` are part of the public API and are
 * semver-covered; `message` is default English text that callers may show
 * as is or replace using `code`. Area-specific subclasses narrow `C` to a
 * string-literal union of their codes.
 */
export class WardenError<C extends string = string, D = unknown> extends Error {
  public constructor(public readonly code: C, message: string, public readonly data?: D) {
    super(message);
    this.name = 'WardenError';
  }
}

const WARDEN_ERROR_NAMES = new Set([
  'WardenError',
  'AccessError',
  'UserAccessError',
  'LifecycleError',
  'ProvisioningError',
  'DefinitionError',
  'CsvReadError',
  'RelatedRecordsError',
]);

/**
 * Structural check for {@link WardenError}. Prefer this over `instanceof`,
 * which fails when a consumer ends up with two copies of this package.
 */
export const isWardenError = (error: unknown): error is WardenError =>
  error instanceof WardenError ||
  (typeof error === 'object' &&
    error !== null &&
    WARDEN_ERROR_NAMES.has(
      typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : ''
    ) &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string');
