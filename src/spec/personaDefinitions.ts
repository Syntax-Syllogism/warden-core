import { z } from 'zod';

const schemaVersionSchema = z.literal(1).optional().describe('Supported file schema version. Omit it for version 1.');

const assignmentModeSchema = z.enum(['additive', 'sync']).describe('How assignments are applied.');

export const personaSchema = z
  .looseObject({
    profile: z.string().optional().describe('Profile name or Salesforce Id.'),
    role: z.string().optional().describe('Role name or Salesforce Id.'),
    permissionSetMode: assignmentModeSchema.optional().describe('Permission Set assignment mode.'),
    permissionSetGroupMode: assignmentModeSchema.optional().describe('Permission Set Group assignment mode.'),
    publicGroupMode: assignmentModeSchema.optional().describe('Public Group assignment mode.'),
    queueMode: assignmentModeSchema.optional().describe('Queue assignment mode.'),
    permissionSets: z.array(z.string()).optional().describe('Permission Set names or Salesforce Ids.'),
    permissionSetGroups: z.array(z.string()).optional().describe('Permission Set Group names or Salesforce Ids.'),
    publicGroups: z.array(z.string()).optional().describe('Public Group names or Salesforce Ids.'),
    queues: z.array(z.string()).optional().describe('Queue names or Salesforce Ids.'),
    userAttributes: z.record(z.string(), z.unknown()).optional().describe('User fields applied by this persona.'),
  })
  .describe('A reusable set of User fields and assignments. Unknown metadata keys are preserved.');

export const personaDefinitionsFileSchema = z
  .looseObject({
    schemaVersion: schemaVersionSchema,
    personas: z.record(z.string(), personaSchema).describe('Persona definitions keyed by persona name.'),
  })
  .describe('A Warden persona definitions file.');

export type PersonaDefinition = z.infer<typeof personaSchema>;
export type PersonaDefinitionsFile = z.infer<typeof personaDefinitionsFileSchema>;
