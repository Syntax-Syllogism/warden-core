/* eslint-disable camelcase -- Salesforce API names in fixtures. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  access,
  commandDescriptors,
  diff,
  freeze,
  provision,
  ProvisionUserUseCase,
  provisionOptionsSchema,
  restore,
  snapshot,
  strip,
  uiHints,
  unfreeze,
  type FreezePlan,
  type ProvisionPlan,
  type RestorePlan,
  type StripPlan,
} from '../src/index.js';
import { WardenError } from '../src/errors.js';

const userFields = [
  { name: 'Username', createable: true, updateable: true, filterable: true, externalId: true },
  { name: 'Email', createable: true, updateable: true, filterable: true },
  { name: 'FirstName', createable: true, updateable: true, filterable: true },
  { name: 'LastName', createable: true, updateable: true, filterable: true },
  { name: 'TimeZoneSidKey', createable: true, updateable: true, filterable: true },
  { name: 'LocaleSidKey', createable: true, updateable: true, filterable: true },
  { name: 'EmailEncodingKey', createable: true, updateable: true, filterable: true },
  { name: 'LanguageLocaleKey', createable: true, updateable: true, filterable: true },
];

const lifecycleConnection = (
  queryResult: unknown[] = [
    { Id: '005user', IsActive: true, Name: 'Alice', Username: 'alice@example.test', Email: 'alice@example.test' },
  ]
) => {
  const query = sinon.stub().callsFake(async (soql: string) => {
    if (soql.includes('FROM User WHERE')) return { records: queryResult };
    return { records: [] };
  });
  return {
    query,
    describe: sinon.stub().resolves({ fields: userFields }),
  } as never;
};

const provisionDocument = {
  users: [{ Username: 'alice@example.test', match: 'Username', personas: [] }],
};

const restoreDocument = {
  snapshotVersion: 1,
  users: [
    {
      match: 'Username',
      matchValue: 'alice@example.test',
      userId: '005old',
      name: 'Old Alice',
      username: 'alice@example.test',
      email: 'alice@example.test',
      IsActive: true,
      IsFrozen: false,
      permissionSets: [],
      permissionSetGroups: [],
      publicGroups: [],
      queues: [],
      permissionSetLicenses: [],
    },
  ],
};

describe('command use cases', () => {
  it('describes exactly the eight commands and annotates every option', () => {
    expect(commandDescriptors).to.have.length(8);
    expect(new Set(commandDescriptors.map((descriptor) => descriptor.id)).size).to.equal(8);
    for (const descriptor of commandDescriptors) {
      const schema = descriptor.optionsSchema as unknown as { shape: Record<string, unknown> };
      const keys = Object.keys(schema.shape);
      const internalKeys = descriptor.id === 'provision' ? ['personasSupplied'] : [];
      expect(Object.keys(uiHints(descriptor.optionsSchema as never))).to.have.members(
        keys.filter((key) => !internalKeys.includes(key))
      );
    }
  });

  it('groups lifecycle and diff user targets and orders persona input after the users file', () => {
    for (const useCase of [freeze, unfreeze, strip, snapshot, diff]) {
      const hints = uiHints(useCase.descriptor.optionsSchema);
      expect(hints.user.exclusiveGroup).to.equal('userTarget');
      expect(hints.usersPath.exclusiveGroup).to.equal('userTarget');
    }
    expect(uiHints(diff.descriptor.optionsSchema).personasPath.dependsOn).to.equal('usersPath');
    expect(uiHints(diff.descriptor.optionsSchema).against.dependsOn).to.equal('user');
  });

  it('rejects an already-aborted operation with the stable cancellation error', async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await freeze.plan({} as never, { user: 'Username:alice@example.test' }, { signal: controller.signal });
      expect.fail('Expected cancellation.');
    } catch (error) {
      expect(error).to.be.instanceOf(WardenError);
      expect((error as WardenError).code).to.equal('cancelled');
    }
  });

  it('keeps a write plan JSON-safe and emits progress around planning', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return { records: [{ Id: '005user', IsActive: true, Name: 'Alice', Username: 'alice@example.test' }] };
      if (soql.includes('FROM UserLogin')) return { records: [{ Id: '0LL', UserId: '005user', IsFrozen: false }] };
      return { records: [] };
    });
    const conn = {
      query,
      describe: sinon.stub().resolves({
        fields: [{ name: 'Username', createable: true, updateable: true, filterable: true, externalId: true }],
      }),
    } as never;
    const events: string[] = [];
    const plan = await freeze.plan(
      conn,
      { user: 'Username:alice@example.test' },
      { onProgress: (event) => events.push(event.phase) }
    );
    const cloned = JSON.parse(JSON.stringify(plan)) as FreezePlan;
    expect(cloned).to.deep.equal(plan);
    expect(events).to.deep.equal(['start', 'complete']);
    const update = sinon.stub().resolves([{ success: true, errors: [] }]);
    const result = await freeze.apply(
      { sobject: sinon.stub().withArgs('UserLogin').returns({ update }) } as never,
      cloned
    );
    expect(result.summary.changed).to.equal(1);
    expect(update.calledOnce).to.equal(true);
  });

  it('builds a strip plan from resolved target and assignment state', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return { records: [{ Id: '005user', IsActive: true, Name: 'Alice', Username: 'alice@example.test' }] };
      return { records: [] };
    });
    const conn = {
      query,
      describe: sinon.stub().resolves({
        fields: [{ name: 'Username', createable: true, updateable: true, filterable: true, externalId: true }],
      }),
    } as never;
    const plan = await strip.plan(conn, {
      user: 'Username:alice@example.test',
      noFreeze: false,
      noDeactivate: false,
      keepPermsets: false,
      keepPermsetGroups: false,
      keepPublicGroups: false,
      keepQueues: false,
      keepLicenses: false,
    });
    expect(plan.preview.users[0].actions.map((action) => action.key)).to.include('wouldDeactivate');
  });

  it('applies a JSON-cloned strip plan and performs the deactivate DML', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return { records: [{ Id: '005user', IsActive: true, Name: 'Alice', Username: 'alice@example.test' }] };
      return { records: [] };
    });
    const conn = {
      query,
      describe: sinon.stub().resolves({
        fields: [{ name: 'Username', createable: true, updateable: true, filterable: true, externalId: true }],
      }),
    } as never;
    const plan = await strip.plan(conn, {
      user: 'Username:alice@example.test',
      noFreeze: false,
      noDeactivate: false,
      keepPermsets: false,
      keepPermsetGroups: false,
      keepPublicGroups: false,
      keepQueues: false,
      keepLicenses: false,
    });
    expect(plan.states[0].steps).to.deep.equal([
      { kind: 'update', sobject: 'User', row: { Id: '005user', IsActive: false }, actionKey: 'deactivated' },
    ]);
    const cloned = JSON.parse(JSON.stringify(plan)) as StripPlan;
    const update = sinon.stub().resolves([{ success: true }]);
    const result = await strip.apply({ sobject: sinon.stub().withArgs('User').returns({ update }) } as never, cloned);
    expect(update.calledOnceWith([{ Id: '005user', IsActive: false }], { allOrNone: false })).to.equal(true);
    expect(result.summary.changed).to.equal(1);
    expect(result.users[0].actions.map((action) => action.key)).to.include('deactivated');
  });

  it('applies a JSON-cloned unfreeze plan and unfreezes a frozen user', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return { records: [{ Id: '005user', IsActive: true, Name: 'Alice', Username: 'alice@example.test' }] };
      if (soql.includes('FROM UserLogin')) return { records: [{ Id: '0LL', UserId: '005user', IsFrozen: true }] };
      return { records: [] };
    });
    const conn = {
      query,
      describe: sinon.stub().resolves({
        fields: [{ name: 'Username', createable: true, updateable: true, filterable: true, externalId: true }],
      }),
    } as never;
    const plan = await unfreeze.plan(conn, { user: 'Username:alice@example.test' });
    expect(plan.updates).to.deep.equal([
      { resultIndex: 0, row: { Id: '0LL', IsFrozen: false }, actionKey: 'unfrozen' },
    ]);
    const cloned = JSON.parse(JSON.stringify(plan)) as FreezePlan;
    const update = sinon.stub().resolves([{ success: true, errors: [] }]);
    const result = await unfreeze.apply(
      { sobject: sinon.stub().withArgs('UserLogin').returns({ update }) } as never,
      cloned
    );
    expect(update.calledOnceWith([{ Id: '0LL', IsFrozen: false }], { allOrNone: false })).to.equal(true);
    expect(result.summary.changed).to.equal(1);
    expect(result.users[0].actions.map((action) => action.key)).to.include('unfrozen');
  });

  it('keeps provision planning read-only and separates preview labels from apply labels', async () => {
    const conn = lifecycleConnection();
    const sobject = sinon.stub();
    (conn as { sobject: typeof sobject }).sobject = sobject;
    const events: string[] = [];
    const plan = await provision.plan(
      conn,
      { usersDoc: provisionDocument, fuzzyUsername: false },
      { onProgress: (event) => events.push(event.phase) }
    );

    expect(sobject.called).to.equal(false);
    expect(plan.preview.users[0].actions.map((action) => action)).to.include('wouldUpdate');
    expect(plan.plans[0].actions).to.include('updated');
    expect(JSON.parse(JSON.stringify(plan))).to.deep.equal(plan);
    expect(events).to.deep.equal(['start', 'complete']);
  });

  for (const cleanupOnFailure of [true, false, undefined]) {
    it(`cleans failed User saves only when opted in (${cleanupOnFailure})`, async () => {
      const plan = await provision.plan(lifecycleConnection(), {
        usersDoc: provisionDocument,
        fuzzyUsername: false,
        cleanupOnFailure,
      });
      expect(plan.cleanupOnFailure).to.equal(cleanupOnFailure ?? false);
      const cloned = JSON.parse(JSON.stringify(plan)) as ProvisionPlan;
      if (cleanupOnFailure === undefined) delete cloned.cleanupOnFailure;
      cloned.plans[0].relatedPlans = [
        {
          relationship: 'contact',
          phase: 'before',
          sobject: 'Contact',
          matchField: 'External_Id__c',
          fields: { External_Id__c: 'alice' },
          pendingUserIdFields: [],
          mode: 'sync',
          status: 'planned',
          errors: [],
          linkUser: { userField: 'ContactId', fromRelatedField: 'Id' },
        },
      ];
      const create = sinon.stub().resolves([{ success: true, id: '003new', errors: [] }]);
      const remove = sinon.stub().resolves([{ success: true, errors: [] }]);
      const update = sinon.stub().resolves([{ success: false, errors: [{ message: 'User save blocked' }] }]);
      const conn = {
        sobject: sinon
          .stub()
          .callsFake((name: string) => (name === 'Contact' ? { create, delete: remove } : { update })),
      };
      const result = await provision.apply(conn as never, cloned);
      expect(remove.called).to.equal(cleanupOnFailure === true);
      expect(result.users[0].relatedRecords?.map((related) => related.action)).to.deep.equal(
        cleanupOnFailure ? ['created', 'deleted'] : ['created']
      );
      expect(result.users[0].errors).to.deep.equal(['User save blocked']);
      expect(result.summary.failed).to.equal(1);
      expect(JSON.stringify(result)).not.to.contain('createdInThisRun');
    });
  }

  it('cleans after creations on post-save failure while keeping saved User links and successful peers', async () => {
    const plan = await provision.plan(lifecycleConnection(), {
      usersDoc: provisionDocument,
      fuzzyUsername: false,
      cleanupOnFailure: true,
    });
    const contact = {
      relationship: 'contact',
      phase: 'before' as const,
      sobject: 'Contact',
      matchField: 'External_Id__c',
      fields: { External_Id__c: 'alice' },
      pendingUserIdFields: [],
      mode: 'sync' as const,
      status: 'planned' as const,
      errors: [],
      linkUser: { userField: 'ContactId', fromRelatedField: 'Id' },
    };
    const employee = {
      ...contact,
      relationship: 'employee',
      phase: 'after' as const,
      sobject: 'Employee__c',
      linkUser: undefined,
    };
    plan.plans[0].relatedPlans = [contact, employee];
    plan.plans[0].effectivePersona = { permissionSets: ['missing'] };
    plan.refs.permissionSetIdsByRef.missing = '0PSmissing';
    plan.plans.push({
      ...plan.plans[0],
      planId: 'peer',
      order: 1,
      key: 'peer',
      target: { ...plan.plans[0].target },
      effectivePersona: {},
      relatedPlans: [{ ...employee, fields: { External_Id__c: 'peer' } }],
      errors: [],
      actions: ['updated'],
    });
    const contactDelete = sinon.stub();
    const employeeDelete = sinon.stub().resolves([{ success: true, errors: [] }]);
    const conn = {
      query: sinon.stub().resolves({ records: [] }),
      sobject: sinon.stub().callsFake((name: string) => {
        if (name === 'User')
          return {
            update: sinon.stub().resolves([
              { success: true, id: '005user', errors: [] },
              { success: true, id: '005peer', errors: [] },
            ]),
          };
        if (name === 'PermissionSetAssignment')
          return { create: sinon.stub().resolves([{ success: false, errors: [{ message: 'Assignment blocked' }] }]) };
        if (name === 'Contact')
          return {
            create: sinon.stub().resolves([{ success: true, id: '003contact', errors: [] }]),
            delete: contactDelete,
          };
        return {
          create: sinon.stub().resolves([
            { success: true, id: 'a01failed', errors: [] },
            { success: true, id: 'a01peer', errors: [] },
          ]),
          delete: employeeDelete,
        };
      }),
    };
    const result = await provision.apply(conn as never, plan);
    expect(result.users[0].status).to.equal('failed');
    expect(result.users[1].status).to.equal('updated');
    expect(contactDelete.called).to.equal(false);
    expect(employeeDelete.calledOnceWith(['a01failed'], { allOrNone: false })).to.equal(true);
    expect(result.users[0].relatedRecords?.map((related) => related.action)).to.deep.equal([
      'created',
      'created',
      'skipped',
      'deleted',
    ]);
    expect(JSON.stringify(result)).not.to.contain('createdInThisRun');
  });

  it('retains a linked before record when the after write fails', async () => {
    const plan = await provision.plan(lifecycleConnection(), {
      usersDoc: provisionDocument,
      fuzzyUsername: false,
      cleanupOnFailure: true,
    });
    const before = {
      relationship: 'contact',
      phase: 'before' as const,
      sobject: 'Contact',
      matchField: 'External_Id__c',
      fields: { External_Id__c: 'alice' },
      pendingUserIdFields: [],
      mode: 'sync' as const,
      status: 'planned' as const,
      errors: [],
      linkUser: { userField: 'ContactId', fromRelatedField: 'Id' },
    };
    plan.plans[0].relatedPlans = [
      before,
      { ...before, relationship: 'employee', phase: 'after', sobject: 'Employee__c', linkUser: undefined },
    ];
    const remove = sinon.stub();
    const conn = {
      query: sinon.stub().resolves({ records: [] }),
      sobject: sinon.stub().callsFake((name: string) => {
        if (name === 'User') return { update: sinon.stub().resolves([{ success: true, id: '005user', errors: [] }]) };
        return {
          create: sinon
            .stub()
            .resolves([
              name === 'Contact'
                ? { success: true, id: '003new', errors: [] }
                : { success: false, errors: [{ message: 'Employee blocked' }] },
            ]),
          delete: remove,
        };
      }),
    };
    const result = await provision.apply(conn as never, plan);
    expect(result.users[0].status).to.equal('failed');
    expect(result.users[0].errors).to.deep.equal(['Employee blocked']);
    expect(remove.called).to.equal(false);
    expect(result.users[0].relatedRecords?.[2].detail).to.contain('saved User');
  });

  for (const legacy of [false, true]) {
    for (const dryRun of [false, true]) {
      it(`preserves before creations through a failed link read (${legacy ? 'legacy' : 'callable'}, ${
        dryRun ? 'preview' : 'live'
      })`, async () => {
        const create = sinon.stub().resolves([{ success: true, id: '003new', errors: [] }]);
        const remove = sinon.stub().resolves([{ success: false, errors: [{ message: 'Delete blocked' }] }]);
        const userUpdate = sinon.stub();
        const sobject = sinon
          .stub()
          .callsFake((name: string) => (name === 'Contact' ? { create, delete: remove } : { update: userUpdate }));
        const conn = {
          describe: sinon.stub().callsFake(async (name: string) => ({
            queryable: true,
            fields:
              name === 'User'
                ? [...userFields, { name: 'ContactId', createable: true, updateable: true }]
                : [
                    {
                      name: 'External_Id__c',
                      createable: true,
                      updateable: true,
                      filterable: true,
                      externalId: true,
                    },
                    { name: 'Id' },
                    { name: 'Link__c' },
                  ],
          })),
          query: sinon.stub().callsFake(async (soql: string) => ({
            records: soql.includes('FROM User WHERE')
              ? [{ Id: '005user', Username: 'alice@example.test', IsActive: true }]
              : [],
          })),
          sobject,
        };
        const options = {
          usersDoc: { users: [{ ...provisionDocument.users[0], personas: ['base'], related: ['contact'] }] },
          personasDoc: { personas: { base: {} } },
          relatedDoc: {
            relationships: {
              contact: {
                sobject: 'Contact',
                phase: 'before',
                match: { field: 'External_Id__c', from: 'user.Username' },
                fields: { External_Id__c: { from: 'user.Username' } },
                linkUser: { userField: 'ContactId', fromRelatedField: 'Link__c' },
              },
            },
          },
          fuzzyUsername: false,
          cleanupOnFailure: true,
        };
        const result = legacy
          ? await new ProvisionUserUseCase().execute({ connection: conn as never, ...options, dryRun })
          : await (async () => {
              const plan = await provision.plan(conn as never, options);
              return dryRun
                ? plan.preview
                : provision.apply(conn as never, JSON.parse(JSON.stringify(plan)) as ProvisionPlan);
            })();
        expect(userUpdate.called).to.equal(false);
        expect(remove.called).to.equal(!dryRun);
        expect(create.called).to.equal(!dryRun);
        expect(JSON.stringify(result)).not.to.contain('createdInThisRun');
        if (!dryRun) {
          expect(result.users[0].relatedRecords?.map((related) => related.action)).to.deep.equal([
            'created',
            'deleteFailed',
          ]);
          expect(result.users[0].errors.join('; ')).to.contain('Cannot resolve Contact.Link__c');
          expect(result.users[0].relatedRecords?.[1].error).to.equal('Delete blocked');
          expect(result.summary.failed).to.equal(1);
        }
      });
    }
  }

  it('applies a JSON-cloned provision plan and checks cancellation between stages', async () => {
    const plan = await provision.plan(lifecycleConnection(), {
      usersDoc: provisionDocument,
      fuzzyUsername: false,
    });
    const cloned = JSON.parse(JSON.stringify(plan)) as ProvisionPlan;
    const controller = new AbortController();
    const update = sinon.stub().callsFake(async () => {
      controller.abort();
      return [{ success: true, id: '005user', errors: [] }];
    });
    const sobject = sinon.stub().withArgs('User').returns({ update });
    try {
      await provision.apply({ sobject } as never, cloned, { signal: controller.signal });
      expect.fail('Expected cancellation.');
    } catch (error) {
      expect((error as WardenError).code).to.equal('cancelled');
      expect(update.calledOnce).to.equal(true);
      expect(sobject.withArgs('UserLogin').called).to.equal(false);
    }
  });

  it('exposes license shortfalls on the plan without interrupting planning', async () => {
    const conn = lifecycleConnection([]) as {
      query: sinon.SinonStub;
      describe: sinon.SinonStub;
    };
    conn.query.callsFake(async (soql: string) => {
      if (soql.includes('FROM Profile WHERE')) return { records: [{ Id: '00e000000000001', UserLicenseId: 'lic1' }] };
      if (soql.includes('FROM UserLicense WHERE'))
        return {
          records: [{ Id: 'lic1', MasterLabel: 'Limited', TotalLicenses: 0, UsedLicenses: 0, Status: 'Active' }],
        };
      return { records: [] };
    });
    const plan = await provision.plan(conn as never, {
      usersDoc: {
        users: [
          {
            FirstName: 'Alice',
            LastName: 'Example',
            Email: 'alice@example.test',
            Username: 'alice@example.test',
            TimeZoneSidKey: 'America/New_York',
            LocaleSidKey: 'en_US',
            EmailEncodingKey: 'UTF-8',
            LanguageLocaleKey: 'en_US',
            personas: ['baseline'],
          },
        ],
      },
      personasDoc: { personas: { baseline: { profile: '00e000000000001' } } },
      fuzzyUsername: false,
    });
    expect(plan.licenses).to.have.length(1);
    expect(plan.licenses[0]?.shortfall).to.equal(1);
    expect(plan.preview.licenses).to.have.length(1);
    expect(plan.preview.licenses?.[0]?.shortfall).to.equal(1);
    expect(plan.preview.users[0].status).to.not.equal('failed');
    expect(plan.preview.summary.warnings).to.equal(1);
    const create = sinon.stub().resolves([{ success: true, id: '005new', errors: [] }]);
    const result = await provision.apply(
      { ...conn, sobject: sinon.stub().withArgs('User').returns({ create }) } as never,
      JSON.parse(JSON.stringify(plan)) as ProvisionPlan
    );
    expect(result.summary.warnings).to.equal(1);
    expect(result.users[0].status).to.equal('created');
    expect(result).not.to.have.property('licenses');
  });

  for (const dryRun of [true, false]) {
    it(`matches legacy provision JSON results (${dryRun ? 'dry run' : 'live'})`, async () => {
      const conn = {
        describe: sinon.stub().resolves({ fields: userFields }),
        query: sinon.stub().callsFake(async (soql: string) => {
          if (soql.includes('FROM User WHERE'))
            return {
              records: [
                { Id: '005alice', Name: 'Alice Example', Username: 'alice@example.test', IsActive: true },
                { Id: '005failed', Name: 'Failed Example', Username: 'failed@example.test', IsActive: true },
              ],
            };
          if (soql.includes('FROM Profile WHERE') && soql.includes('00e000000000001'))
            return { records: [{ Id: '00e000000000001', Name: 'Standard', UserLicenseId: 'lic1' }] };
          if (soql.includes('FROM UserLicense WHERE'))
            return {
              records: [{ Id: 'lic1', MasterLabel: 'Standard', TotalLicenses: 10, UsedLicenses: 0, Status: 'Active' }],
            };
          return { records: [] };
        }),
        sobject: sinon
          .stub()
          .withArgs('User')
          .returns({
            create: sinon.stub().resolves([{ success: true, id: '005new', errors: [] }]),
            update: sinon.stub().resolves([
              { success: true, id: '005alice', errors: [] },
              { success: false, errors: [{ message: 'Save rejected' }] },
            ]),
          }),
      };
      const options = {
        usersDoc: {
          users: [
            { Username: 'alice@example.test', match: 'Username', personas: ['baseline'] },
            { Username: 'failed@example.test', match: 'Username', personas: ['baseline'] },
            {
              Username: 'invalid@example.test',
              FirstName: 'Invalid',
              LastName: 'Example',
              match: 'Username',
              personas: ['unknown'],
            },
            {
              Username: 'new@example.test',
              FirstName: 'New',
              LastName: 'Example',
              Email: 'new@example.test',
              TimeZoneSidKey: 'America/New_York',
              LocaleSidKey: 'en_US',
              EmailEncodingKey: 'UTF-8',
              LanguageLocaleKey: 'en_US',
              personas: ['baseline'],
            },
          ],
        },
        personasDoc: { personas: { baseline: { profile: '00e000000000001' }, unused: { profile: 'Missing' } } },
        fuzzyUsername: false,
      };
      const plan = await provision.plan(conn as never, options);
      expect(conn.sobject.called).to.equal(false);
      const actual = dryRun
        ? plan.preview
        : await provision.apply(conn as never, JSON.parse(JSON.stringify(plan)) as ProvisionPlan);
      const expected = await new ProvisionUserUseCase().execute({ connection: conn as never, ...options, dryRun });
      expect(JSON.parse(JSON.stringify(actual))).to.deep.equal(JSON.parse(JSON.stringify(expected)));
      expect(actual.users.map((user) => user.username)).to.deep.equal([
        'alice@example.test',
        'failed@example.test',
        'invalid@example.test',
        'new@example.test',
      ]);
      expect(actual.users[2].matchValue).to.equal('invalid@example.test');
      expect(actual.users[3].matchedBy).to.equal(null);
      expect(actual.summary.warnings).to.equal(1);
      if (!dryRun) expect(actual.users[1].errors[0]).to.contain('Save rejected');
    });
  }

  it('preserves CSV source prefixes for validation and save failures through JSON-cloned plans', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'warden-provision-source-'));
    const usersPath = join(directory, 'users.csv');
    const personasPath = join(directory, 'personas.json');
    try {
      await writeFile(
        usersPath,
        [
          'Username,match,personas',
          'alice@example.test,Username,baseline',
          'invalid@example.test,Username,unknown',
        ].join('\n')
      );
      await writeFile(personasPath, JSON.stringify({ personas: { baseline: {} } }));
      const conn = {
        ...(lifecycleConnection() as { query: sinon.SinonStub; describe: sinon.SinonStub }),
        sobject: sinon
          .stub()
          .withArgs('User')
          .returns({
            update: sinon.stub().resolves([{ success: false, errors: [{ message: 'Save rejected' }] }]),
          }),
      };
      const plan = await provision.plan(conn as never, { usersPath, personasPath, fuzzyUsername: false });
      expect(plan.preview.users[1].errors[0]).to.contain(`${usersPath}:3 — `);
      const result = await provision.apply(conn as never, JSON.parse(JSON.stringify(plan)) as ProvisionPlan);
      expect(result.users[0].errors[0]).to.contain(`${usersPath}:2 — `);
      expect(result.users[0].errors[0]).to.contain('Save rejected');
      expect(result.users[1].errors).to.deep.equal(plan.preview.users[1].errors);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts the internal personasSupplied override without a UI hint', async () => {
    expect(uiHints(provisionOptionsSchema)).not.to.have.property('personasSupplied');
    const options = provisionOptionsSchema.parse({
      usersDoc: { users: [{ Username: 'alice@example.test', match: 'Username', personas: ['unknown'] }] },
      personasSupplied: true,
    });
    expect(options.personasSupplied).to.equal(true);
    const conn = lifecycleConnection();
    const plan = await provision.plan(conn, options);
    const expected = await new ProvisionUserUseCase().execute({
      connection: conn,
      usersDoc: options.usersDoc,
      personasSupplied: options.personasSupplied,
      dryRun: true,
    });
    expect(JSON.parse(JSON.stringify(plan.preview))).to.deep.equal(JSON.parse(JSON.stringify(expected)));
    expect(plan.preview.users[0].status).to.equal('failed');
  });

  it('preserves restore identity review, mismatch warnings, and unchanged no-op previews', async () => {
    const conn = lifecycleConnection();
    const sobject = sinon.stub();
    (conn as { sobject: typeof sobject }).sobject = sobject;
    const plan = await restore.plan(conn, { snapshotDoc: restoreDocument });
    const user = plan.preview.users[0];

    expect(user.status).to.equal('unchanged');
    expect(user.actions).to.deep.equal([]);
    expect(user.identityReview?.snapshot.name).to.equal('Old Alice');
    expect(user.warnings).to.deep.equal(['Snapshot name "Old Alice" differs from org "Alice".']);
    expect(sobject.called).to.equal(false);
    expect(JSON.parse(JSON.stringify(plan))).to.deep.equal(plan);
  });

  it('applies a JSON-cloned restore plan with activation, unfreeze, and permission set DML', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return {
          records: [
            {
              Id: '005user',
              IsActive: false,
              Name: 'Alice',
              Username: 'alice@example.test',
              Email: 'alice@example.test',
            },
          ],
        };
      if (soql.includes('FROM UserLogin WHERE'))
        return { records: [{ Id: '0LL1', UserId: '005user', IsFrozen: true }] };
      if (soql.includes('FROM PermissionSet WHERE')) return { records: [{ Id: '0PS1', Name: 'PS_Admin' }] };
      return { records: [] };
    });
    const conn = { query, describe: sinon.stub().resolves({ fields: userFields }) } as never;
    const plan = await restore.plan(conn, {
      snapshotDoc: {
        snapshotVersion: 1,
        users: [
          {
            match: 'Username',
            matchValue: 'alice@example.test',
            userId: '005old',
            name: 'Alice',
            username: 'alice@example.test',
            email: 'alice@example.test',
            IsActive: true,
            IsFrozen: false,
            permissionSets: ['PS_Admin'],
            permissionSetGroups: [],
            publicGroups: [],
            queues: [],
            permissionSetLicenses: [],
          },
        ],
      },
    });
    expect(plan.users[0].userUpdate).to.deep.equal({ Id: '005user', IsActive: true });
    expect(plan.users[0].loginUpdates).to.deep.equal([{ Id: '0LL1', IsFrozen: false }]);
    expect(plan.users[0].permissionSetAdds).to.deep.equal(['0PS1']);

    const cloned = JSON.parse(JSON.stringify(plan)) as RestorePlan;
    const userUpdate = sinon.stub().resolves([{ success: true }]);
    const loginUpdate = sinon.stub().resolves([{ success: true }]);
    const psaCreate = sinon.stub().resolves([{ success: true, id: '0PSA1' }]);
    const sobject = sinon.stub();
    sobject.withArgs('User').returns({ update: userUpdate });
    sobject.withArgs('UserLogin').returns({ update: loginUpdate });
    sobject.withArgs('PermissionSetAssignment').returns({ create: psaCreate });
    const result = await restore.apply({ sobject } as never, cloned);

    expect(userUpdate.calledOnceWith([{ Id: '005user', IsActive: true }], { allOrNone: false })).to.equal(true);
    expect(loginUpdate.calledOnceWith([{ Id: '0LL1', IsFrozen: false }], { allOrNone: false })).to.equal(true);
    expect(
      psaCreate.calledOnceWith([{ AssigneeId: '005user', PermissionSetId: '0PS1' }], { allOrNone: false })
    ).to.equal(true);
    expect(result.users[0].status).to.equal('changed');
    expect(result.users[0].actions.map((action) => action.key)).to.include.members([
      'activated',
      'unfrozen',
      'assignedPermissionSet',
    ]);
  });

  it('cancels a restore apply between users and does not write the remaining user', async () => {
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM User WHERE'))
        return {
          records: [
            { Id: '005alice', IsActive: false, Name: 'Alice', Username: 'alice@example.test' },
            { Id: '005bob', IsActive: false, Name: 'Bob', Username: 'bob@example.test' },
          ],
        };
      return { records: [] };
    });
    const conn = { query, describe: sinon.stub().resolves({ fields: userFields }) } as never;
    const plan = await restore.plan(conn, {
      snapshotDoc: {
        snapshotVersion: 1,
        users: [
          {
            match: 'Username',
            matchValue: 'alice@example.test',
            userId: '005old1',
            IsActive: true,
            IsFrozen: false,
            permissionSets: [],
            permissionSetGroups: [],
            publicGroups: [],
            queues: [],
            permissionSetLicenses: [],
          },
          {
            match: 'Username',
            matchValue: 'bob@example.test',
            userId: '005old2',
            IsActive: true,
            IsFrozen: false,
            permissionSets: [],
            permissionSetGroups: [],
            publicGroups: [],
            queues: [],
            permissionSetLicenses: [],
          },
        ],
      },
    });
    expect(plan.users).to.have.length(2);
    expect(plan.users[0].userUpdate).to.deep.equal({ Id: '005alice', IsActive: true });
    expect(plan.users[1].userUpdate).to.deep.equal({ Id: '005bob', IsActive: true });

    const cloned = JSON.parse(JSON.stringify(plan)) as RestorePlan;
    const controller = new AbortController();
    const update = sinon.stub().callsFake(async () => {
      controller.abort();
      return [{ success: true }];
    });
    const sobject = sinon.stub().withArgs('User').returns({ update });
    try {
      await restore.apply({ sobject } as never, cloned, { signal: controller.signal });
      expect.fail('Expected cancellation.');
    } catch (error) {
      expect((error as WardenError).code).to.equal('cancelled');
      expect(update.calledOnce).to.equal(true);
    }
  });

  it('runs the diff verification branch in core and exposes its option', async () => {
    const result = await diff.run(lifecycleConnection(), {
      mode: 'persona',
      verify: true,
      usersDoc: { users: [{ Username: 'alice@example.test', match: 'Username', personas: ['baseline'] }] },
      personasDoc: { personas: { baseline: {} } },
    });

    expect(result).to.deep.equal([{ key: 'alice@example.test', conformant: true, violations: [] }]);
    const parsed = commandDescriptors
      .find((descriptor) => descriptor.id === 'diff')
      ?.optionsSchema.parse({
        mode: 'persona',
      }) as { verify: boolean };
    expect(parsed.verify).to.equal(false);
  });

  it('rejects an access request that combines target and sobject scopes', async () => {
    try {
      await access.run({} as never, { type: 'object', target: 'Account', sobject: 'Contact' });
      expect.fail('Expected a scope validation error.');
    } catch (error) {
      expect((error as WardenError).code).to.equal('errorAccessScopesMutuallyExclusive');
    }
  });

  it('covers read and reversible write use cases with progress events', async () => {
    const conn = lifecycleConnection();
    const snapshotEvents: string[] = [];
    await snapshot.run(
      conn,
      { user: 'Username:alice@example.test' },
      { onProgress: (event) => snapshotEvents.push(event.phase) }
    );
    expect(snapshotEvents).to.deep.equal(['start', 'complete']);

    const unfreezeEvents: string[] = [];
    await unfreeze.plan(
      conn,
      { user: 'Username:alice@example.test' },
      { onProgress: (event) => unfreezeEvents.push(event.phase) }
    );
    expect(unfreezeEvents).to.deep.equal(['start', 'complete']);

    const restoreEvents: string[] = [];
    await restore.apply(
      conn,
      {
        users: [],
        errors: [],
        warnings: [],
        preview: { summary: { total: 0, changed: 0, unchanged: 0, failed: 0 }, users: [] },
      },
      { onProgress: (event) => restoreEvents.push(event.phase) }
    );
    expect(restoreEvents).to.deep.equal(['apply', 'complete']);
  });
});
