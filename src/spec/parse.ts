import type { z } from 'zod';
import { DefinitionError } from '../provisioning/errors.js';
import { personaDefinitionsFileSchema } from './personaDefinitions.js';
import { relatedCatalogSchema } from './relatedCatalog.js';
import { snapshotFileSchema } from './snapshot.js';
import { usersDefinitionFileSchema } from './usersDefinition.js';
import { conformanceFixtureSchema } from './conformanceFixture.js';
import type { ConformanceFixture } from './conformanceFixture.js';
import type { PersonaDefinitionsFile } from './personaDefinitions.js';
import type { RelatedCatalog } from './relatedCatalog.js';
import type { UserSnapshotFile } from './snapshot.js';
import type { UsersDefinitionFile } from './usersDefinition.js';

export type SchemaIssue = { path: Array<string | number>; message: string };
export type SchemaSuccess<T> = { ok: true; data: T; issues: [] };
export type SchemaFailure = { ok: false; issues: SchemaIssue[]; error: DefinitionError };
export type SchemaResult<T> = SchemaSuccess<T> | SchemaFailure;

const issuesFrom = (issues: z.ZodIssue[]): SchemaIssue[] =>
  issues.map(({ path, message }) => ({
    path: path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'),
    message,
  }));

const issueText = (issues: SchemaIssue[]): string =>
  issues.map(({ path, message }) => `${path.length > 0 ? path.join('.') : '$'}: ${message}`).join('\n');

const versionIssue = (path: Array<string | number>): SchemaIssue => ({
  path,
  message: 'Unsupported schemaVersion; this reader supports version 1.',
});

const unsupportedSchemaVersion = (input: unknown): SchemaResult<never> | undefined => {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input)) return undefined;
  const schemaVersion = (input as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion <= 1) return undefined;
  const issues = [versionIssue(['schemaVersion'])];
  return {
    ok: false,
    issues,
    error: new DefinitionError('schema-version-unsupported', issueText(issues), { issues }),
  };
};

const parseSchema = <T>(schema: z.ZodType<T>, input: unknown): SchemaResult<T> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = issuesFrom(parsed.error.issues);
    return {
      ok: false,
      issues,
      error: new DefinitionError('schema-invalid', issueText(issues), { issues }),
    };
  }
  return { ok: true, data: parsed.data, issues: [] };
};

const parseVersionedSchema = <T>(schema: z.ZodType<T>, input: unknown): SchemaResult<T> => {
  const unsupported = unsupportedSchemaVersion(input);
  return unsupported ?? parseSchema(schema, input);
};

const parseOrThrow = <T>(result: SchemaResult<T>): T => {
  if (!result.ok) throw result.error;
  return result.data;
};

const parseText = <T>(parse: (input: unknown) => SchemaResult<T>, text: string, label: string): SchemaResult<T> => {
  try {
    return parse(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const issues: SchemaIssue[] = [{ path: [], message: `Invalid JSON: ${error.message}` }];
      return {
        ok: false,
        issues,
        error: new DefinitionError('schema-invalid', `${label}: ${issueText(issues)}`, { issues }),
      };
    }
    throw error;
  }
};

export const safeParsePersonaDefinitions = (input: unknown): SchemaResult<PersonaDefinitionsFile> =>
  parseVersionedSchema(personaDefinitionsFileSchema, input);
export const parsePersonaDefinitions = (input: unknown): PersonaDefinitionsFile =>
  parseOrThrow(safeParsePersonaDefinitions(input));
export const validatePersonaDefinitionsText = (text: string): SchemaResult<PersonaDefinitionsFile> =>
  parseText((input) => parseVersionedSchema(personaDefinitionsFileSchema, input), text, 'Persona definitions');

export const safeParseUsersDefinition = (input: unknown): SchemaResult<UsersDefinitionFile> =>
  parseVersionedSchema(usersDefinitionFileSchema, input);
export const parseUsersDefinition = (input: unknown): UsersDefinitionFile =>
  parseOrThrow(safeParseUsersDefinition(input));
export const validateUsersDefinitionText = (text: string): SchemaResult<UsersDefinitionFile> =>
  parseText((input) => parseVersionedSchema(usersDefinitionFileSchema, input), text, 'Users definition');

export const safeParseRelatedCatalog = (input: unknown): SchemaResult<RelatedCatalog> =>
  parseVersionedSchema(relatedCatalogSchema, input);
export const parseRelatedCatalog = (input: unknown): RelatedCatalog => parseOrThrow(safeParseRelatedCatalog(input));
export const validateRelatedCatalogText = (text: string): SchemaResult<RelatedCatalog> =>
  parseText((input) => parseVersionedSchema(relatedCatalogSchema, input), text, 'Related catalog');

export const safeParseSnapshot = (input: unknown): SchemaResult<UserSnapshotFile> =>
  parseSchema(snapshotFileSchema, input);
export const parseSnapshot = (input: unknown): UserSnapshotFile => parseOrThrow(safeParseSnapshot(input));
export const validateSnapshotText = (text: string): SchemaResult<UserSnapshotFile> =>
  parseText((input) => parseSchema(snapshotFileSchema, input), text, 'Snapshot');

export const safeParseConformanceFixture = (input: unknown): SchemaResult<ConformanceFixture> =>
  parseVersionedSchema(conformanceFixtureSchema, input);
export const parseConformanceFixture = (input: unknown): ConformanceFixture =>
  parseOrThrow(safeParseConformanceFixture(input));
export const validateConformanceFixtureText = (text: string): SchemaResult<ConformanceFixture> =>
  parseText((input) => parseVersionedSchema(conformanceFixtureSchema, input), text, 'Conformance fixture');
