import { z } from 'zod';
import { personaDefinitionsFileSchema } from './personaDefinitions.js';
import { userInputSchema, usersDefinitionFileSchema } from './usersDefinition.js';

const schemaVersionSchema = z.literal(1).describe('Conformance fixture format version.');

const conformanceUserSchema = userInputSchema
  .extend({
    userKey: z.string().min(1).describe('Stable engine-neutral user key.'),
    userId: z.string().min(1).describe('Simulated Salesforce User Id.'),
  })
  .describe('A user definition with the identity fields required by conformance planning.');

export const conformanceUsersDefinitionSchema = usersDefinitionFileSchema
  .extend({ users: z.array(conformanceUserSchema).describe('Fixture users.') })
  .describe('The users definition embedded in a conformance fixture.');

export const conformanceDefinitionsSchema = z
  .object({
    personas: personaDefinitionsFileSchema.describe('Persona definitions used by the fixture.'),
    users: conformanceUsersDefinitionSchema,
  })
  .describe('Persona and user definition documents used as conformance input.');

const setupReferenceSchema = z
  .looseObject({
    id: z.string().min(1).describe('Simulated Salesforce Id.'),
    name: z.string().min(1).optional().describe('Permission Set name or group name.'),
    developerName: z.string().min(1).optional().describe('DeveloperName used for a setup reference.'),
    label: z.string().min(1).optional().describe('Human-readable target label.'),
  })
  .describe('A simulated setup-object reference.');

const groupSchema = setupReferenceSchema
  .extend({ type: z.enum(['Regular', 'Queue']).describe('Salesforce Group type.') })
  .describe('A simulated Public Group or Queue.');

const assignmentSchema = z
  .looseObject({
    id: z.string().min(1).describe('Simulated PermissionSetAssignment Id.'),
    userId: z.string().min(1).describe('Assigned User Id.'),
    permissionSetId: z.string().min(1).nullable().optional(),
    permissionSetGroupId: z.string().min(1).nullable().optional(),
  })
  .describe('A simulated PermissionSetAssignment row.');

const groupMemberSchema = z
  .looseObject({
    id: z.string().min(1).describe('Simulated GroupMember Id.'),
    userId: z.string().min(1).describe('Member User Id.'),
    groupId: z.string().min(1).describe('Group Id.'),
  })
  .describe('A simulated GroupMember row.');

export const conformanceOrgStateSchema = z
  .looseObject({
    permissionSets: z.array(setupReferenceSchema).describe('Permission Sets available for reference resolution.'),
    permissionSetGroups: z
      .array(setupReferenceSchema)
      .describe('Permission Set Groups available for reference resolution.'),
    groups: z.array(groupSchema).describe('Public Groups and Queues available for reference resolution.'),
    permissionSetAssignments: z.array(assignmentSchema).describe('Existing PermissionSetAssignment rows.'),
    groupMembers: z.array(groupMemberSchema).describe('Existing GroupMember rows.'),
  })
  .describe('A simulated current-org setup-object and assignment snapshot.');

export const conformanceCategorySchema = z.enum(['PermissionSet', 'PermissionSetGroup', 'PublicGroup', 'Queue']);

export const conformancePlanRowSchema = z
  .object({
    userKey: z.string().min(1),
    userId: z.string().min(1),
    category: conformanceCategorySchema,
    action: z.enum(['wouldAssign', 'unresolved']),
    status: z.enum(['planned', 'unmanaged']),
    detail: z.string(),
    error: z.string(),
  })
  .describe('One deterministic reconciliation plan row.');

export const conformanceFixtureSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    definitions: conformanceDefinitionsSchema,
    orgState: conformanceOrgStateSchema,
    expectedPlan: z.array(conformancePlanRowSchema).describe('Expected deterministic reconciliation plan rows.'),
  })
  .describe('A Warden v1 conformance fixture: definitions plus simulated org state and expected plan.');

export type ConformanceFixture = z.infer<typeof conformanceFixtureSchema>;
export type ConformanceDefinitions = z.infer<typeof conformanceDefinitionsSchema>;
export type ConformanceOrgState = z.infer<typeof conformanceOrgStateSchema>;
export type ConformanceCategory = z.infer<typeof conformanceCategorySchema>;
export type ConformancePlanRow = z.infer<typeof conformancePlanRowSchema>;
