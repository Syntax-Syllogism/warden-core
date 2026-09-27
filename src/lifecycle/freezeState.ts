import type { UserLoginRow } from './assignmentState.js';

export type FreezeDirection = {
  /** Value written to UserLogin.IsFrozen. */
  targetState: boolean;
  /** True when the user is already in targetState and no DML is needed. */
  isAlreadyInState: (row: UserLoginRow) => boolean;
  alreadyKey: string;
  wouldKey: string;
  actionKey: string;
};

export const FREEZE: FreezeDirection = {
  targetState: true,
  isAlreadyInState: (row) => row.IsFrozen,
  alreadyKey: 'alreadyFrozen',
  wouldKey: 'wouldFreeze',
  actionKey: 'frozen',
};

export const UNFREEZE: FreezeDirection = {
  targetState: false,
  isAlreadyInState: (row) => !row.IsFrozen,
  alreadyKey: 'alreadyUnfrozen',
  wouldKey: 'wouldUnfreeze',
  actionKey: 'unfrozen',
};
