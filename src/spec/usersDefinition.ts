import { z } from 'zod';

const schemaVersionSchema = z.literal(1).optional().describe('Supported file schema version. Omit it for version 1.');

export const userInputSchema = z
  .looseObject({
    personas: z.array(z.string()).optional().describe('Persona names to merge for this user.'),
  })
  .describe('A User field record with optional Warden metadata.');

export const usersDefinitionFileSchema = z
  .looseObject({
    schemaVersion: schemaVersionSchema,
    users: z.array(userInputSchema).describe('User definitions.'),
  })
  .describe('A Warden JSON users definition file.');

/**
 * CSV has no JSON Schema because its User columns come from Salesforce describe metadata.
 * The fixed metadata columns are `personas`, `match`, and `fuzzyUsername`; all other
 * columns are User API names. `personas` is a semicolon-delimited list by default,
 * configurable with `csvListDelimiter`.
 */
export const USERS_CSV_COLUMNS = ['personas', 'match', 'fuzzyUsername'] as const;

export type UserInput = z.infer<typeof userInputSchema>;
export type UsersDefinitionFile = z.infer<typeof usersDefinitionFileSchema>;
