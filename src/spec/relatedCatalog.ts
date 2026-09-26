import { z } from 'zod';

const schemaVersionSchema = z.literal(1).optional().describe('Supported file schema version. Omit it for version 1.');

const sourceExprSchema = z.union([
  z.strictObject({ from: z.string().describe('A source such as user.Department or user.Id.') }),
  z.strictObject({ value: z.unknown().describe('A literal value.') }),
]);

export const relationshipDefSchema = z
  .looseObject({
    sobject: z.string().describe('Target Salesforce object API name.'),
    phase: z.enum(['before', 'after']).describe('When the relationship is applied.'),
    recordType: z
      .looseObject({ developerName: z.string().describe('Record Type developer name.') })
      .optional()
      .nullable()
      .describe('Optional target record type.'),
    match: z
      .looseObject({
        field: z.string().describe('Target field used to find an existing record.'),
        from: z.string().describe('User source used for the target match.'),
      })
      .describe('Target match configuration.'),
    fields: z.record(z.string(), sourceExprSchema).describe('Target fields and their source expressions.'),
    mode: z.enum(['setIfEmpty', 'sync']).nullish().describe('How configured fields are updated.'),
  })
  .describe('A reusable related-record relationship.');

export const relatedCatalogSchema = z
  .looseObject({
    schemaVersion: schemaVersionSchema,
    relationships: z.record(z.string(), relationshipDefSchema).describe('Relationships keyed by name.'),
  })
  .describe('A Warden related-record catalog.');

export type SourceExpr = z.infer<typeof sourceExprSchema>;
export type RelationshipDef = z.infer<typeof relationshipDefSchema>;
export type RelationshipMode = NonNullable<RelationshipDef['mode']>;
export type RelationshipPhase = RelationshipDef['phase'];
export type RelatedCatalog = z.infer<typeof relatedCatalogSchema>;
