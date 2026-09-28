import { expect } from 'chai';
import {
  renderAccessResult,
  renderLifecycleResult,
  renderMessages,
  renderMessagesFor,
  renderProvisionHuman,
  renderSnapshotCsv,
  snapshotToLifecycleResult,
  type ProvisionResult,
  type UserAccessResult,
  type UserSnapshotFile,
} from '../src/index.js';

describe('default rendering', () => {
  it('resolves lifecycle notices and verification text, substitutes arguments, and preserves unknown keys', () => {
    for (const key of [
      'alreadyFrozen',
      'wouldFreeze',
      'frozen',
      'alreadyUnfrozen',
      'wouldUnfreeze',
      'unfrozen',
      'alreadyInactive',
      'wouldDeactivate',
      'deactivated',
      'snapshotWritten',
      'skippedFreeze',
      'skippedDeactivate',
      'wouldRemovePermissionSet',
      'removedPermissionSet',
      'skippedPermissionSets',
      'wouldRemovePermissionSetGroup',
      'removedPermissionSetGroup',
      'skippedPermissionSetGroups',
      'wouldRemovePermissionSetLicense',
      'removedPermissionSetLicense',
      'skippedPermissionSetLicenses',
      'wouldRemovePublicGroupMember',
      'removedPublicGroupMember',
      'skippedPublicGroups',
      'wouldRemoveQueueMember',
      'removedQueueMember',
      'skippedQueues',
      'skippedProfileOwnedPermissionSets',
      'wouldActivate',
      'activated',
      'wouldAssignPermissionSet',
      'assignedPermissionSet',
      'wouldAssignPermissionSetGroup',
      'assignedPermissionSetGroup',
      'wouldAssignPermissionSetLicense',
      'assignedPermissionSetLicense',
      'wouldAddPublicGroupMember',
      'addedPublicGroupMember',
      'wouldAddQueueMember',
      'addedQueueMember',
      'verify.summary',
      'verify.user',
      'verify.violation.notFound',
      'verify.violation.error',
      'verify.violation.missing',
      'verify.violation.extra',
      'verify.violation.profile',
      'verify.violation.role',
    ])
      expect(renderMessages(key)).not.to.equal(key);
    expect(renderMessages('wouldRemovePermissionSet', ['2'])).to.equal('Would remove 2 permission set assignments.');
    expect(renderMessages('unknown.key')).to.equal('unknown.key');
    expect(renderMessagesFor('diff')('info.summary', ['2', '1', '0'])).to.equal(
      'Compared 2 users: 1 with drift, 0 failed.'
    );
    expect(renderMessagesFor('freeze')('info.summary', ['1', '', '0', '1', '0'])).to.equal(
      'Processed 1 user: 0 changed, 1 unchanged, 0 failed.'
    );
  });

  it('renders provision plan previews and apply results with license shortfalls', () => {
    const preview = {
      summary: { total: 1, created: 1, updated: 0, failed: 0, warnings: 1 },
      users: [
        {
          key: 'alice@example.test',
          id: undefined,
          status: 'planned',
          matchedBy: 'Username',
          matched: false,
          matchValue: 'alice@example.test',
          personas: ['Sales'],
          actions: ['would create'],
          errors: [],
          relatedRecords: [],
        },
      ],
      licenses: [{ licenseName: 'Salesforce', required: 2, available: 1, unlimited: false, shortfall: 1 }],
    } as ProvisionResult;
    expect(renderProvisionHuman(preview, 'file')).to.equal(
      [
        'Persona source: file',
        '',
        'alice@example.test · planned',
        '  unmatched Username = alice@example.test · personas: Sales',
        '  action: would create',
        '',
        'Processed 1 users: 1 created, 0 updated, 0 failed.',
        '',
        'User license headroom for net-new users:',
        'Salesforce: required 2, available 1, shortfall 1',
        'Permission set license headroom: not evaluated.',
      ].join('\n')
    );
    const applied = {
      ...preview,
      users: [{ ...preview.users[0], id: '005abc', status: 'created', actions: ['created'] }],
    } as ProvisionResult;
    expect(renderProvisionHuman(applied, 'org')).to.include('alice@example.test · 005abc · created');
    expect(renderProvisionHuman(applied, 'org')).to.include('  action: created');
  });

  it('renders access results for field, object, and enabled grants', () => {
    const base = {
      targetName: 'Account.Name',
      rows: [],
      warnings: [],
      stats: { totalActiveUsersWithAccess: 1, profileGrants: 1, permissionSetGrants: 0, permissionSetGroupGrants: 0 },
    };
    const row = {
      userId: '005abc',
      userName: 'Alice',
      username: 'alice@example.test',
      targetType: 'field',
      targetName: 'Account.Name',
      assignmentType: 'Profile',
      sourceId: '00eabc',
      sourceName: 'Standard User',
      access: { kind: 'field', read: true, edit: false },
    };
    const field = { ...base, targetType: 'field', rows: [row] } as UserAccessResult;
    expect(renderAccessResult(field)).to.equal(
      [
        'Field: Account.Name',
        'Active users with access: 1',
        'Profiles: 1 | Permission Sets: 0 | Permission Set Groups: 0',
        '',
        'User Name  Username            Read  Edit  Via',
        'Alice      alice@example.test  yes   no    Profile: Standard User',
      ].join('\n')
    );
    const object = {
      ...base,
      targetType: 'object',
      targetName: 'Account',
      rows: [
        {
          ...row,
          targetType: 'object',
          targetName: 'Account',
          access: {
            kind: 'object',
            read: true,
            create: false,
            edit: false,
            delete: false,
            viewAll: false,
            modifyAll: false,
          },
        },
      ],
    } as UserAccessResult;
    expect(renderAccessResult(object)).to.include(
      'Alice      alice@example.test  Y  N  N  N  N   N   Profile: Standard User'
    );
    const enabled = {
      ...base,
      targetType: 'apex-class',
      targetName: 'MyClass',
      rows: [{ ...row, targetType: 'apex-class', targetName: 'MyClass', access: { kind: 'enabled', enabled: true } }],
    } as UserAccessResult;
    expect(renderAccessResult(enabled)).to.include('Alice      alice@example.test  yes      Profile: Standard User');
    expect(renderAccessResult({ ...base, targetType: 'field' } as UserAccessResult, 'Alice')).to.include(
      'No access grants matched this user and scope.'
    );
  });

  it('adapts a snapshot file for lifecycle human and CSV rendering', () => {
    const file = {
      snapshotVersion: 1,
      users: [
        {
          match: 'Username',
          matchValue: 'alice@example.test',
          userId: '005abc',
          name: 'Alice',
          username: 'alice@example.test',
          IsActive: true,
          IsFrozen: false,
          permissionSets: [],
          permissionSetGroups: [],
          publicGroups: [],
          queues: [],
          permissionSetLicenses: [],
        },
      ],
    } as UserSnapshotFile;
    const result = snapshotToLifecycleResult(file);
    expect(renderLifecycleResult(result, renderMessages)).to.equal(
      [
        'Processed 1 user: 0 changed, 1 unchanged, 0 failed.',
        '',
        'Alice <alice@example.test> · 005abc',
        '  matched Username = alice@example.test · was active',
        '  action: Wrote snapshot.',
      ].join('\n')
    );
    expect(renderSnapshotCsv(result)).to.equal(
      'key,id,status,actions,skipped,warnings,errors\nUsername:alice@example.test,005abc,unchanged,snapshotWritten,,,'
    );
  });
});
