import { z } from 'zod';
import type { UiHint } from './useCase.js';

const field = <T extends z.ZodType>(schema: T, ui: UiHint): T =>
  (schema as T & { meta: (value: unknown) => T }).meta({ ui });

const file = (label: string, fileFilter: UiHint['fileFilter'] = 'json', extra: Partial<UiHint> = {}): z.ZodString =>
  field(z.string(), { kind: 'file', label, fileFilter, ...extra });

const text = (label: string, extra: Partial<UiHint> = {}): z.ZodString =>
  field(z.string(), { kind: 'string', label, ...extra });

const boolean = (label: string): z.ZodBoolean => field(z.boolean(), { kind: 'boolean', label });

const enumValue = (values: [string, ...string[]], label: string): z.ZodType<string> =>
  field(z.enum(values), { kind: 'enum', label });

const document = (label: string): z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>> =>
  field(z.record(z.string(), z.unknown()).optional(), { kind: 'string', label });

const targetFields = {
  user: text('User match (field:value)', { exclusiveGroup: 'userTarget' }).optional(),
  usersPath: file('Users definition file', 'json-or-csv', { exclusiveGroup: 'userTarget' }).optional(),
  usersDoc: document('Users definition document').optional(),
  externalId: text('External ID field', { dependsOn: 'usersPath' }).optional(),
  inputFormat: enumValue(['json', 'csv'], 'Input format').optional(),
  csvListDelimiter: text('CSV list delimiter', { dependsOn: 'inputFormat' }).optional(),
};

export const provisionOptionsSchema = z.object({
  usersPath: file('Users definition file', 'json-or-csv').optional(),
  usersDoc: document('Users definition document').optional(),
  personasPath: file('Personas definition file').optional(),
  personasDoc: document('Personas definition document').optional(),
  personasSupplied: z.boolean().optional(),
  cleanupOnFailure: boolean('Delete related records created for failed users').default(false),
  relatedPath: file('Related record definition file').optional(),
  relatedDoc: document('Related record definition document').optional(),
  externalId: text('External ID field', { dependsOn: 'usersPath' }).optional(),
  inputFormat: enumValue(['json', 'csv'], 'Input format').optional(),
  csvListDelimiter: text('CSV list delimiter', { dependsOn: 'inputFormat' }).optional(),
  fuzzyUsername: boolean('Allow fuzzy usernames').default(false),
});

export const freezeOptionsSchema = z.object({
  ...targetFields,
});

export const unfreezeOptionsSchema = z.object({
  ...targetFields,
});

export const stripOptionsSchema = z.object({
  ...targetFields,
  noFreeze: boolean('Do not freeze users').default(false),
  noDeactivate: boolean('Do not deactivate users').default(false),
  keepPermsets: boolean('Keep permission sets').default(false),
  keepPermsetGroups: boolean('Keep permission set groups').default(false),
  keepPublicGroups: boolean('Keep public groups').default(false),
  keepQueues: boolean('Keep queues').default(false),
  keepLicenses: boolean('Keep permission set licenses').default(false),
});

export const diffOptionsSchema = z.object({
  mode: enumValue(['persona', 'user'], 'Diff mode'),
  verify: boolean('Verify conformance').default(false),
  user: text('User match (field:value)', { exclusiveGroup: 'userTarget' }).optional(),
  against: text('Reference user match (field:value)', { dependsOn: 'user' }).optional(),
  usersPath: file('Users definition file', 'json-or-csv', { exclusiveGroup: 'userTarget' }).optional(),
  usersDoc: document('Users definition document').optional(),
  personasPath: file('Personas definition file', 'json', { dependsOn: 'usersPath' }).optional(),
  personasDoc: document('Personas definition document').optional(),
  externalId: text('External ID field', { dependsOn: 'usersPath' }).optional(),
  inputFormat: enumValue(['json', 'csv'], 'Input format').optional(),
  csvListDelimiter: text('CSV list delimiter', { dependsOn: 'inputFormat' }).optional(),
});

export const accessOptionsSchema = z.object({
  type: enumValue(
    ['field', 'object', 'apex-class', 'vf-page', 'custom-permission', 'tab', 'record-type'],
    'Access type'
  ),
  target: text('Access target', { exclusiveGroup: 'target' }).optional(),
  user: text('User match (field:value)', { exclusiveGroup: 'user' }).optional(),
  sobject: text('SObject API name', { dependsOn: 'user' }).optional(),
});

export const snapshotOptionsSchema = z.object({
  ...targetFields,
  org: text('Org provenance').optional(),
});

export const restoreOptionsSchema = z.object({
  snapshotPath: file('Snapshot file').optional(),
  snapshotDoc: document('Snapshot document').optional(),
});

export type ProvisionOptions = Omit<z.infer<typeof provisionOptionsSchema>, 'cleanupOnFailure'> & {
  cleanupOnFailure?: boolean;
};
export type FreezeOptions = z.infer<typeof freezeOptionsSchema>;
export type UnfreezeOptions = z.infer<typeof unfreezeOptionsSchema>;
export type StripOptions = z.infer<typeof stripOptionsSchema>;
export type DiffOptions = z.infer<typeof diffOptionsSchema>;
export type AccessOptions = z.infer<typeof accessOptionsSchema>;
export type SnapshotOptions = z.infer<typeof snapshotOptionsSchema>;
export type RestoreOptions = z.infer<typeof restoreOptionsSchema>;
