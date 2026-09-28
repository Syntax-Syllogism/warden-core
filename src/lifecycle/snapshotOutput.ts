import type { UserSnapshotFile } from '../spec/snapshot.js';
import { makeNotice, summarizeLifecycle } from './output.js';
import type { LifecycleResult, LifecycleUserResult } from './types.js';

/** Build the CLI-style result for a successfully captured snapshot. */
export const snapshotToLifecycleResult = (file: UserSnapshotFile): LifecycleResult => {
  const users: LifecycleUserResult[] = file.users.map((user) => ({
    key: `${user.match}:${user.matchValue}`,
    id: user.userId,
    name: user.name,
    username: user.username,
    isActive: user.IsActive,
    isFrozen: user.IsFrozen,
    status: 'unchanged',
    actions: [makeNotice('snapshotWritten')],
    skipped: [],
    warnings: [],
    errors: [],
  }));
  return { summary: summarizeLifecycle(users), users };
};
