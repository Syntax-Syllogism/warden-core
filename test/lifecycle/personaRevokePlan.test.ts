import { expect } from 'chai';
import { planPersonaRevocation } from '../../src/lifecycle/personaRevokePlan.js';

const refs = {
  profilesByRef: new Map<string, string>(),
  rolesByRef: new Map<string, string>(),
  permissionSetIdsByRef: new Map([
    ['shared', '0PSshared'],
    ['support', '0PSsupport'],
  ]),
  permissionSetGroupIdsByRef: new Map([['group', '0PGgroup']]),
  publicGroupIdsByRef: new Map<string, string>(),
  queueIdsByRef: new Map<string, string>(),
  labels: {
    '0PSshared': { id: '0PSshared', label: 'Shared' },
    '0PSsupport': { id: '0PSsupport', label: 'Support' },
    '0PGgroup': { id: '0PGgroup', label: 'Group' },
  },
  warnings: [],
};

describe('persona revocation plan', () => {
  it('keeps a target covered by a persona the user retains', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['shared', 'support'] }, sales: { permissionSets: ['shared'] } },
      heldPersonas: ['support', 'sales'],
      removePersonas: ['support'],
      refs,
      assignmentRows: [
        {
          Id: '0PSAshared',
          AssigneeId: '005user',
          PermissionSetId: '0PSshared',
          PermissionSet: { IsOwnedByProfile: false },
        },
        {
          Id: '0PSAsupport',
          AssigneeId: '005user',
          PermissionSetId: '0PSsupport',
          PermissionSet: { IsOwnedByProfile: false },
        },
      ],
      membershipRows: [],
    });

    expect(plan.rows).to.deep.include({
      userKey: 'alice',
      userId: '005user',
      category: 'PermissionSet',
      action: 'keptByOtherPersona',
      status: 'kept',
      detail: 'Shared (kept by sales)',
      error: '',
    });
    expect(plan.steps[0]).to.include({
      kind: 'delete',
      sobject: 'PermissionSetAssignment',
      actionKey: 'removedPermissionSet',
    });
    if (plan.steps[0]?.kind === 'delete') expect(plan.steps[0].ids).to.deep.equal(['0PSAsupport']);
    expect(plan.removedTargets).to.deep.equal(new Set(['0PSsupport']));
  });

  it('does not mark shared or absent targets as removed, and honors keep flags', () => {
    const shared = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['shared'] }, sales: { permissionSets: ['shared'] } },
      heldPersonas: ['support', 'sales'],
      removePersonas: ['support'],
      refs,
      assignmentRows: [{ Id: '0PSAshared', AssigneeId: '005user', PermissionSetId: '0PSshared' }],
      membershipRows: [],
    });
    expect(shared.removedTargets).to.deep.equal(new Set());

    const absent = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['support'] } },
      heldPersonas: ['support'],
      removePersonas: 'all',
      refs,
      assignmentRows: [],
      membershipRows: [],
    });
    expect(absent.removedTargets).to.deep.equal(new Set());

    const keptByFlag = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['support'] } },
      heldPersonas: ['support'],
      removePersonas: 'all',
      refs,
      assignmentRows: [{ Id: '0PSAsupport', AssigneeId: '005user', PermissionSetId: '0PSsupport' }],
      membershipRows: [],
      flags: { 'keep-permsets': true },
    });
    expect(keptByFlag.rows[0]?.action).to.equal('wouldRemove');
    expect(keptByFlag.removedTargets).to.deep.equal(new Set());
    expect(keptByFlag.steps).to.deep.equal([]);
  });

  it('warns for unmanaged removals and reports an unknown persona once', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['support'] } },
      heldPersonas: ['support', 'missing'],
      removePersonas: 'all',
      refs,
      assignmentRows: [{ Id: '0PSAsupport', AssigneeId: '005user', PermissionSetId: '0PSsupport' }],
      membershipRows: [],
      ledgerTargets: new Map(),
    });
    expect(plan.warnings).to.deep.equal(['removedUnmanagedGrant: Support for alice.']);
    expect(plan.rows.filter((entry) => entry.detail === 'missing')).to.have.length(1);
    expect(plan.rows.filter((entry) => entry.action === 'unresolved')).to.have.length(1);
  });

  it('checks ledger provenance separately for each removed persona', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['shared'] }, sales: { permissionSets: ['shared'] } },
      heldPersonas: ['support', 'sales'],
      removePersonas: 'all',
      refs,
      assignmentRows: [{ Id: '0PSAshared', AssigneeId: '005user', PermissionSetId: '0PSshared' }],
      membershipRows: [],
      ledgerTargets: new Map([['support', new Set(['0PSshared'])]]),
    });

    expect(plan.warnings).to.deep.equal(['removedUnmanagedGrant: Shared for alice.']);
  });

  it('does not remove access while a retained persona definition is missing', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['support'] } },
      heldPersonas: ['support', 'sales'],
      removePersonas: ['support'],
      refs,
      assignmentRows: [{ Id: '0PSAsupport', AssigneeId: '005user', PermissionSetId: '0PSsupport' }],
      membershipRows: [],
    });

    expect(plan.rows).to.deep.include({
      userKey: 'alice',
      userId: '005user',
      category: 'PermissionSet',
      action: 'unresolved',
      status: 'unmanaged',
      detail: 'sales',
      error: 'Unresolved retained persona definition "sales".',
    });
    expect(plan.rows.some((entry) => entry.action === 'wouldRemove')).to.equal(false);
    expect(plan.steps).to.deep.equal([]);
    expect(plan.removedTargets).to.deep.equal(new Set());
  });

  it('removes permission set group assignments and leaves profile-owned assignments alone', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSetGroups: ['group'] } },
      heldPersonas: ['support'],
      removePersonas: 'all',
      refs,
      assignmentRows: [
        {
          Id: '0PSAgroup',
          AssigneeId: '005user',
          PermissionSetGroupId: '0PGgroup',
          PermissionSetGroup: { DeveloperName: 'group' },
        },
        {
          Id: '0PSAprofile',
          AssigneeId: '005user',
          PermissionSetId: '0PSprofile',
          PermissionSet: { IsOwnedByProfile: true },
        },
      ],
      membershipRows: [],
    });
    expect(plan.steps[0]).to.deep.include({ ids: ['0PSAgroup'], sobject: 'PermissionSetAssignment' });
    expect(plan.steps[0]).not.to.deep.include({ ids: ['0PSAprofile'] });
  });

  it('reports absent targets and does not create delete steps in a dry run', () => {
    const plan = planPersonaRevocation({
      userKey: 'alice',
      userId: '005user',
      personas: { support: { permissionSets: ['support'] } },
      heldPersonas: ['support'],
      removePersonas: ['support'],
      refs,
      assignmentRows: [],
      membershipRows: [],
      flags: { 'dry-run': true },
    });
    expect(plan.rows[0]?.action).to.equal('alreadyAbsent');
    expect(plan.steps).to.deep.equal([]);
  });
});
