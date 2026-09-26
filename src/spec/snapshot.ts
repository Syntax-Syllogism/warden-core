import { z } from 'zod';

const optionalSnapshotText = z.string().optional();

export const userSnapshotEntrySchema = z
  .looseObject({
    match: z.string().min(1).describe('User field used to identify the snapshot entry.'),
    matchValue: z.string().min(1).describe('Value used with the match field.'),
    userId: z.string().min(1).describe('Salesforce User Id.'),
    name: optionalSnapshotText.describe('User name at capture time.'),
    username: optionalSnapshotText.describe('User username at capture time.'),
    email: optionalSnapshotText.describe('User email at capture time.'),
    profile: optionalSnapshotText.describe('User profile at capture time.'),
    role: optionalSnapshotText.describe('User role at capture time.'),
    IsActive: z.boolean().describe('Whether the User was active at capture time.'),
    IsFrozen: z.boolean().describe('Whether the User login was frozen at capture time.'),
    permissionSets: z.array(z.string()).describe('Permission Set names.'),
    permissionSetGroups: z.array(z.string()).describe('Permission Set Group names.'),
    publicGroups: z.array(z.string()).describe('Public Group names.'),
    queues: z.array(z.string()).describe('Queue names.'),
    permissionSetLicenses: z.array(z.string()).describe('Permission Set License names.'),
  })
  .describe('A User assignment snapshot entry.');

export const snapshotFileSchema = z
  .looseObject({
    snapshotVersion: z.literal(1).describe('Snapshot format version.'),
    // Optional: version-1 JSON snapshots written before this schema existed
    // were accepted without it, and the reader must keep accepting them.
    capturedAt: z.string().optional().describe('Capture timestamp in ISO format.'),
    org: z.string().optional().describe('Optional org alias or username.'),
    users: z.array(userSnapshotEntrySchema).describe('Captured User state.'),
  })
  .describe('A Warden User snapshot file.');

export type UserSnapshotEntry = z.infer<typeof userSnapshotEntrySchema>;
export type UserSnapshotFile = z.infer<typeof snapshotFileSchema>;
