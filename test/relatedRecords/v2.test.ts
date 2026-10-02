/* eslint-disable camelcase -- Salesforce fields are intentional. */
import { expect } from 'chai';
import sinon from 'sinon';
import { provision, ProvisionUserUseCase } from '../../src/index.js';
import { assertValidRelatedCatalog } from '../../src/relatedRecords/catalog.js';
import { applyBeforeRelatedPhase } from '../../src/relatedRecords/apply.js';
import { resolveRelatedContext } from '../../src/relatedRecords/context.js';
import { buildRelatedPlans } from '../../src/relatedRecords/plan.js';
import { matchQueryBatches } from '../../src/relatedRecords/queries.js';
import { emptyPreflightResult, runRelatedPreflight } from '../../src/relatedRecords/preflight.js';
import { resolveSource } from '../../src/relatedRecords/sources.js';
import { validateAndCanonicalizeUsers } from '../../src/provisioning/planner.js';
import type { CanonicalizedUser, UserFieldMeta } from '../../src/provisioning/planner.js';
import type { RelatedCatalog, RelatedRecordPlan } from '../../src/relatedRecords/types.js';
import { parseUsersDefinition, parseRelatedCatalog } from '../../src/spec/parse.js';

const meta = (name: string): UserFieldMeta => ({
  name,
  createable: true,
  updateable: true,
  filterable: true,
  externalId: true,
});
const userFields = new Map(
  [
    'Username',
    'ContactId',
    'ProfileId',
    'LastName',
    'Email',
    'Alias',
    'TimeZoneSidKey',
    'LocaleSidKey',
    'EmailEncodingKey',
    'LanguageLocaleKey',
  ].map((name) => [name.toLowerCase(), meta(name)])
);
const catalog: RelatedCatalog = {
  relationships: {
    contact: {
      sobject: 'Contact',
      phase: 'before',
      match: { field: 'External__c', from: 'user.Username' },
      fields: { LastName: { value: 'Test' }, AccountId: { from: 'context.account' } },
      linkUser: { userField: 'ContactId', fromRelatedField: 'Id' },
    },
  },
};
const user = (name: string, context: Record<string, unknown> = {}): CanonicalizedUser => ({
  inputKey: name,
  personas: [],
  effectivePersona: {},
  fields: { Username: name },
  related: ['contact'],
  relatedContext: context,
});
const beforePlan = (index = 0): RelatedRecordPlan => ({
  relationship: 'contact',
  phase: 'before',
  sobject: 'Contact',
  matchField: 'External__c',
  fields: { External__c: String(index) },
  pendingUserIdFields: [],
  mode: 'setIfEmpty',
  status: 'planned',
  errors: [],
  linkUser: { userField: 'ContactId', fromRelatedField: 'Id' },
});
const message = (key: string): string => key;
const contextOptions = (
  users: CanonicalizedUser[],
  query: sinon.SinonStub = sinon.stub().resolves({ records: [] })
) => ({
  conn: { query, describe: sinon.stub().resolves({ fields: [meta('External__c')] }) } as never,
  users: users.map((entry, order) => ({ user: entry, order })),
  catalog,
  userFieldMap: userFields,
  cache: new Map(),
  message,
});

const fakeConnection = (failContact = false, failUser = false) => {
  const contactCreate = sinon
    .stub()
    .callsFake(async (rows: unknown[]) =>
      rows.map((_, i) =>
        failContact && i === 1
          ? { success: false, errors: [{ message: 'contact failed', statusCode: 'INVALID_INPUT' }] }
          : { success: true, id: `003-${i}`, errors: [] }
      )
    );
  const userCreate = sinon
    .stub()
    .callsFake(async (rows: unknown[]) =>
      rows.map((_, i) =>
        failUser
          ? { success: false, errors: [{ message: 'user failed', statusCode: 'INVALID_INPUT' }] }
          : { success: true, id: `005-${i}`, errors: [] }
      )
    );
  const employeeCreate = sinon.stub().resolves([{ success: true, id: 'emp', errors: [] }]);
  const sobject = sinon.stub().callsFake((name: string) => ({
    create: name === 'Contact' ? contactCreate : name === 'Employee__c' ? employeeCreate : userCreate,
  }));
  const query = sinon.stub().callsFake(async (soql: string) => {
    if (soql.includes('UserLicense.Name'))
      return { records: [{ Id: '00e000000000001AAA', Name: 'Standard', UserLicense: { Name: 'Salesforce' } }] };
    if (soql.includes('FROM Account')) return { records: [{ Id: '001-account', External__c: 'company' }] };
    return { records: [] };
  });
  const describe = sinon.stub().callsFake(async (name: string) => ({
    name,
    fields:
      name === 'User'
        ? [...userFields.values()]
        : [meta('Id'), meta('External__c'), meta('LastName'), meta('AccountId'), meta('User__c')],
  }));
  return {
    conn: { query, describe, sobject, instanceUrl: 'https://example.my.salesforce.com' } as never,
    contactCreate,
    userCreate,
    employeeCreate,
    sobject,
    query,
  };
};
const usersDoc = (count = 1) => ({
  users: Array.from({ length: count }, (_, i) => ({
    Username: `user${i}@example.test`,
    LastName: 'Test',
    Email: 'test@example.test',
    Alias: 'test',
    TimeZoneSidKey: 'America/New_York',
    LocaleSidKey: 'en_US',
    EmailEncodingKey: 'UTF-8',
    LanguageLocaleKey: 'en_US',
    ProfileId: '00e000000000001AAA',
    related: ['contact'],
    relatedContext: { account: { lookup: { sobject: 'Account', field: 'External__c', value: { value: 'company' } } } },
  })),
});

describe('related-record v2', () => {
  it('accepts before/context/linkUser and rejects invalid source scopes and link shapes', () => {
    expect(assertValidRelatedCatalog(catalog, userFields).relationships.contact.phase).to.equal('before');
    const def = catalog.relationships.contact;
    expect(() => assertValidRelatedCatalog({ relationships: { x: { ...def, phase: 'after' } } }, userFields)).to.throw(
      'only supported on before'
    );
    expect(() =>
      assertValidRelatedCatalog(
        { relationships: { x: { ...def, fields: { LastName: { from: 'user.Id' } } } } },
        userFields
      )
    ).to.throw();
    expect(() =>
      assertValidRelatedCatalog(
        { relationships: { x: { ...def, match: { field: 'External__c', from: 'context.account' } } } },
        userFields
      )
    ).to.throw('match.from');
    expect(() =>
      assertValidRelatedCatalog(
        { relationships: { x: { ...def, linkUser: { userField: ' ', fromRelatedField: 'Id' } } } },
        userFields
      )
    ).to.throw('non-empty');
    expect(() =>
      parseRelatedCatalog({ relationships: { x: { ...def, linkUser: { userField: 'ContactId' } } } })
    ).to.throw();
    expect(() =>
      assertValidRelatedCatalog(
        { relationships: { x: { ...def, fields: { PersonContactId: { value: 'x' } } } } },
        userFields
      )
    ).to.throw();
  });

  it('validates users metadata structurally and extracts case-insensitive raw metadata', () => {
    expect(parseUsersDefinition(usersDoc()).users[0].relatedContext).to.have.property('account');
    for (const data of [
      { related: 'contact' },
      { relatedContext: [] },
      { relatedContext: { x: { lookup: { field: 'X', value: { value: 1 } } } } },
      { relatedContext: { x: { lookup: { sobject: 'Account', field: 'X', value: { value: 1 }, extra: 1 } } } },
    ]) {
      expect(() => parseUsersDefinition({ users: [data] })).to.throw();
    }
    const result = validateAndCanonicalizeUsers(
      [{ Username: 'u', RelatedContext: { x: 0 } }],
      {},
      userFields,
      false
    )[0];
    expect(result.relatedContext).to.deep.equal({ x: 0 });
    expect(result.fields).to.not.have.property('RelatedContext');
    expect(
      validateAndCanonicalizeUsers(
        [{ Username: 'u', relatedContext: [] }],
        {},
        userFields,
        false
      )[0].validationErrors?.map((e) => e.code)
    ).to.include('errorInvalidRelatedContext');
  });

  it('resolves exact context keys including false/zero and fails empty values', () => {
    const ctx = {
      relationship: 'x',
      fieldName: 'X',
      userFields: {},
      userFieldMap: userFields,
      relatedContext: { yes: false, rank: 0, empty: '', nil: null },
    };
    expect(resolveSource({ from: 'context.yes' }, ctx)).to.deep.equal({ value: false });
    expect(resolveSource({ from: 'context.rank' }, ctx)).to.deep.equal({ value: 0 });
    expect(resolveSource({ from: 'context.Yes' }, ctx).error?.code).to.equal('errorUnknownContextName');
    for (const name of ['empty', 'nil'])
      expect(resolveSource({ from: `context.${name}` }, ctx).error?.code).to.equal('errorRelatedSourceEmpty');
  });

  it('batches shared lookups and isolates missing, ambiguous, and invalid sources', async () => {
    const lookup = (value: unknown) => ({ account: { lookup: { sobject: 'Account', field: 'External__c', value } } });
    const query = sinon.stub().resolves({
      records: [
        { Id: '001', External__c: 'one' },
        { Id: '002', External__c: 'two' },
        { Id: '003', External__c: 'two' },
      ],
    });
    const resolved = await resolveRelatedContext(
      contextOptions(
        [
          user('a', lookup({ value: 'one' })),
          user('b', lookup({ value: 'one' })),
          user('c', lookup({ value: 'missing' })),
          user('d', lookup({ value: 'two' })),
          user('e', lookup({ from: 'context.other' })),
          user('f', lookup({ from: 'user.Id' })),
          user('g', { account: false, unused: { bad: true } }),
        ],
        query
      )
    );
    expect(query.callCount).to.equal(1);
    expect(resolved.get(0)?.values.account).to.equal('001');
    expect(resolved.get(1)?.values.account).to.equal('001');
    expect(resolved.get(2)?.errors).to.include('errorLookupNotFound');
    expect(resolved.get(3)?.errors).to.include('errorLookupAmbiguous');
    for (const order of [4, 5]) expect(resolved.get(order)?.errors).to.include('errorInvalidLookup');
    expect(resolved.get(6)?.values).to.deep.equal({ account: false });
    expect(resolved.get(6)?.errors).to.deep.equal([]);
  });

  it('chunks lookup requests at 200 and rejects ineligible fields without querying', async () => {
    const options = contextOptions(
      Array.from({ length: 250 }, (_, i) =>
        user(String(i), {
          account: { lookup: { sobject: 'Account', field: 'External__c', value: { value: String(i) } } },
        })
      )
    );
    await resolveRelatedContext(options);
    expect((options.conn as unknown as { query: sinon.SinonStub }).query.callCount).to.equal(2);
    const query = sinon.stub();
    const invalid = contextOptions(
      [user('a', { account: { lookup: { sobject: 'Account', field: 'Name', value: { value: 'x' } } } })],
      query
    );
    expect((await resolveRelatedContext(invalid)).get(0)?.errors).to.include('errorLookupFieldIneligible');
    expect(query.called).to.equal(false);
  });

  it('checks link field permissions in preflight', async () => {
    const conn = {
      describe: sinon.stub().resolves({
        fields: [meta('External__c'), meta('LastName'), meta('AccountId'), { ...meta('Id'), readable: false }],
      }),
    } as never;
    const result = await runRelatedPreflight({
      conn,
      catalog,
      selected: ['contact'],
      userFieldMap: userFields,
      cache: new Map(),
    });
    expect(result.ineligible.has('contact')).to.equal(true);
    expect(result.warnings).to.have.length(1);
  });

  it('selects existing link fields and rejects competing links per user', async () => {
    const def = { ...catalog.relationships.contact, fields: { LastName: { value: 'Test' } } };
    const selected = { relationships: { contact: def, other: def } };
    const query = sinon.stub().resolves({ records: [{ Id: '003', External__c: 'a', LastName: 'Test' }] });
    const preflight = emptyPreflightResult();
    preflight.eligible = new Set(['contact', 'other']);
    preflight.fieldsBySobject.set(
      'contact',
      new Map(['Id', 'External__c', 'LastName'].map((name) => [name.toLowerCase(), meta(name)]))
    );
    const plans = await buildRelatedPlans({
      conn: { query } as never,
      catalog: selected,
      users: [{ order: 0, user: { ...user('a'), related: ['contact', 'other'] } }],
      preflight,
      userFieldMap: userFields,
      message,
    });
    expect(query.firstCall.args[0]).to.include('SELECT Id');
    expect(plans.get(0)?.[0].linkValue).to.equal('003');
    expect(plans.get(0)?.every((p) => p.errors.includes('errorConflictingLinkUser'))).to.equal(true);
  });

  for (const scenario of [
    { mode: 'sync' as const, existing: 'Old', planned: 'New' },
    { mode: 'setIfEmpty' as const, existing: '', planned: 'New' },
    { mode: 'setIfEmpty' as const, existing: null, planned: 'New' },
    { mode: 'sync' as const, existing: 'Old', planned: null },
  ]) {
    it(`links the updated field for ${scenario.mode} from ${String(scenario.existing)} to ${String(
      scenario.planned
    )}`, async () => {
      const query = sinon.stub().resolves({
        records: [{ Id: '003', External__c: 'a', LastName: scenario.existing }],
      });
      const preflight = emptyPreflightResult();
      preflight.eligible.add('contact');
      preflight.fieldsBySobject.set(
        'contact',
        new Map(['Id', 'External__c', 'LastName'].map((name) => [name.toLowerCase(), meta(name)]))
      );
      const plans = await buildRelatedPlans({
        conn: { query } as never,
        users: [{ order: 0, user: user('a') }],
        catalog: {
          relationships: {
            contact: {
              ...catalog.relationships.contact,
              mode: scenario.mode,
              fields: { lastname: { value: scenario.planned } },
              linkUser: { userField: 'lastname', fromRelatedField: 'lastname' },
            },
          },
        },
        preflight,
        userFieldMap: userFields,
      });
      const update = sinon.stub().resolves([{ success: true, id: '003' }]);
      const target: Record<string, unknown> = {};
      const outcomes = await applyBeforeRelatedPhase({ query, sobject: () => ({ update }) } as never, [
        { planId: 'a', relatedPlans: JSON.parse(JSON.stringify(plans.get(0))) as RelatedRecordPlan[], target },
      ]);
      expect(update.firstCall.args[0]).to.deep.equal([{ Id: '003', LastName: scenario.planned }]);
      expect(query.callCount).to.equal(1);
      expect(outcomes.get('a')?.failed).to.equal(scenario.planned === null);
      if (scenario.planned === null) expect(target).not.to.have.property('LastName');
      else expect(target.LastName).to.equal(scenario.planned);
    });
  }

  it('partitions before DML and injects Id links', async () => {
    const create = sinon
      .stub()
      .callsFake(async (rows: unknown[]) => rows.map((_, i) => ({ success: true, id: `003-${i}` })));
    const entries = Array.from({ length: 250 }, (_, i) => ({
      planId: String(i),
      relatedPlans: [beforePlan(i)],
      target: {} as Record<string, unknown>,
    }));
    await applyBeforeRelatedPhase({ sobject: () => ({ create }) } as never, entries);
    expect(create.firstCall.args[0]).to.have.length(200);
    expect(create.secondCall.args[0]).to.have.length(50);
    expect(entries[0].target.ContactId).to.equal('003-0');
  });

  it('reads generated linking values only for created records and fails missing values', async () => {
    const plan = {
      ...beforePlan(),
      sobject: 'Account',
      linkUser: { userField: 'ContactId', fromRelatedField: 'PersonContactId' },
    };
    const query = sinon.stub().resolves({ records: [{ Id: '001-new', PersonContactId: '003-new' }] });
    const create = sinon.stub().resolves([{ success: true, id: '001-new' }]);
    const entries = [
      { planId: 'new', relatedPlans: [plan], target: {} as Record<string, unknown> },
      {
        planId: 'existing',
        relatedPlans: [{ ...plan, existingId: '001-old', fields: {}, linkValue: '003-old' }],
        target: {} as Record<string, unknown>,
      },
    ];
    await applyBeforeRelatedPhase({ query, sobject: () => ({ create }) } as never, entries);
    expect(query.callCount).to.equal(1);
    expect(query.firstCall.args[0]).to.not.include('001-old');
    expect(entries.map((e) => e.target.ContactId)).to.deep.equal(['003-new', '003-old']);
    query.resolves({ records: [] });
    expect(
      (await applyBeforeRelatedPhase({ query, sobject: () => ({ create }) } as never, [entries[0]])).get('new')?.failed
    ).to.equal(true);
  });

  it('applies JSON-round-tripped plans before User DML and preserves before/after output', async () => {
    const fake = fakeConnection();
    const doc = usersDoc();
    doc.users[0].related.push('employee');
    const relatedDoc = {
      relationships: {
        ...catalog.relationships,
        employee: {
          sobject: 'Employee__c',
          phase: 'after',
          match: { field: 'External__c', from: 'user.Username' },
          fields: { User__c: { from: 'user.Id' } },
        },
      },
    };
    const plan = await provision.plan(fake.conn, {
      usersDoc: doc,
      relatedDoc,
      personasSupplied: false,
      fuzzyUsername: false,
    });
    expect(fake.sobject.called).to.equal(false);
    expect(plan.preview.users[0].relatedRecords?.[0].phase).to.equal('before');
    expect(plan.warnings.join(' ')).to.include('Salesforce');
    expect(plan.warnings).to.have.length(1);
    const result = await provision.apply(fake.conn, JSON.parse(JSON.stringify(plan)) as typeof plan);
    expect(result.summary.warnings).to.equal(plan.warnings.length);
    expect(fake.contactCreate.calledBefore(fake.userCreate)).to.equal(true);
    expect(fake.employeeCreate.calledAfter(fake.userCreate)).to.equal(true);
    expect((fake.userCreate.firstCall.args[0] as Array<Record<string, unknown>>)[0].ContactId).to.equal('003-0');
    expect((fake.contactCreate.firstCall.args[0] as Array<Record<string, unknown>>)[0].AccountId).to.equal(
      '001-account'
    );
    expect(result.users[0].relatedRecords?.map((r) => r.phase)).to.deep.equal(['before', 'after']);
  });

  it('keeps unrelated relationships planned when a referenced lookup fails', async () => {
    const selected: RelatedCatalog = {
      relationships: {
        ...catalog.relationships,
        employee: {
          ...catalog.relationships.contact,
          phase: 'after',
          linkUser: undefined,
          fields: { LastName: { value: 'Test' } },
        },
      },
    };
    const preflight = emptyPreflightResult();
    preflight.eligible = new Set(['contact', 'employee']);
    preflight.fieldsBySobject.set(
      'contact',
      new Map(['Id', 'External__c', 'LastName', 'AccountId'].map((name) => [name.toLowerCase(), meta(name)]))
    );
    const plans = await buildRelatedPlans({
      conn: { query: sinon.stub().resolves({ records: [] }) } as never,
      catalog: selected,
      users: [{ order: 0, user: { ...user('a'), related: ['contact', 'employee'] } }],
      preflight,
      userFieldMap: userFields,
    });
    expect(plans.get(0)?.map((plan) => plan.status)).to.deep.equal(['failed', 'planned']);
  });

  it('fails conflicting links before any DML and ignores unused context without a catalog', async () => {
    const fake = fakeConnection();
    const doc = usersDoc();
    doc.users[0].related.push('duplicate');
    const plan = await provision.plan(fake.conn, {
      usersDoc: doc,
      relatedDoc: {
        relationships: {
          ...catalog.relationships,
          duplicate: catalog.relationships.contact,
        },
      },
      personasSupplied: false,
      fuzzyUsername: false,
    });
    const result = await provision.apply(fake.conn, plan);
    expect(result.users[0].errors.join(' ')).to.include('Multiple before relationships');
    expect(fake.sobject.called).to.equal(false);
    const plain = { users: [{ ...usersDoc().users[0], related: undefined }] };
    const withoutCatalog = await provision.plan(fake.conn, {
      usersDoc: plain,
      personasSupplied: false,
      fuzzyUsername: false,
    });
    expect(withoutCatalog.plans[0].target).to.not.have.property('relatedContext');
    expect(fake.query.getCalls().some((call) => String(call.args[0]).includes('FROM Account'))).to.equal(true);
    const beforeQueries = fake.query.callCount;
    await provision.plan(fake.conn, { usersDoc: plain, personasSupplied: false, fuzzyUsername: false });
    expect(
      fake.query
        .getCalls()
        .slice(beforeQueries)
        .some((call) => String(call.args[0]).includes('FROM Account'))
    ).to.equal(false);
  });

  it('requeries a created Person Account between Account and User saves', async () => {
    const fake = fakeConnection();
    const accountCreate = sinon.stub().resolves([{ success: true, id: '001-new', errors: [] }]);
    const query = sinon.stub().callsFake(async (soql: string) => {
      if (soql.includes('FROM RecordType'))
        return {
          records: [
            { Id: '012-person', DeveloperName: 'Person', SobjectType: 'Account', IsActive: true, IsPersonType: true },
          ],
        };
      if (soql.includes('FROM Account') && soql.includes('WHERE Id IN'))
        return { records: [{ Id: '001-new', PersonContactId: '003-generated' }] };
      return { records: [] };
    });
    const describe = sinon.stub().callsFake(async (name: string) =>
      name === 'User'
        ? { fields: [...userFields.values()] }
        : {
            fields: [
              meta('Id'),
              meta('External__c'),
              meta('LastName'),
              meta('IsPersonAccount'),
              { ...meta('PersonContactId'), createable: false, updateable: false },
            ],
            recordTypeInfos: [{ recordTypeId: '012-person', available: true }],
          }
    );
    const sobject = sinon
      .stub()
      .callsFake((name: string) => ({ create: name === 'Account' ? accountCreate : fake.userCreate }));
    const conn = { query, describe, sobject, instanceUrl: 'https://example.my.salesforce.com' } as never;
    const relatedDoc: RelatedCatalog = {
      relationships: {
        contact: {
          ...catalog.relationships.contact,
          sobject: 'Account',
          recordType: { developerName: 'Person' },
          fields: { LastName: { value: 'Test' } },
          linkUser: { userField: 'ContactId', fromRelatedField: 'PersonContactId' },
        },
      },
    };
    const plan = await provision.plan(conn, {
      usersDoc: usersDoc(),
      relatedDoc,
      personasSupplied: false,
      fuzzyUsername: false,
    });
    expect(sobject.called).to.equal(false);
    const result = await provision.apply(conn, JSON.parse(JSON.stringify(plan)) as typeof plan);
    expect(result.users[0].status).to.equal('created');
    expect(accountCreate.calledBefore(fake.userCreate)).to.equal(true);
    const linkingRead = query
      .getCalls()
      .find((call) => String(call.args[0]).includes('WHERE Id IN') && String(call.args[0]).includes('FROM Account'));
    expect(linkingRead?.calledAfter(accountCreate.firstCall)).to.equal(true);
    expect(linkingRead?.calledBefore(fake.userCreate.firstCall)).to.equal(true);
    expect((fake.userCreate.firstCall.args[0] as Array<Record<string, unknown>>)[0].ContactId).to.equal(
      '003-generated'
    );
  });

  it('bounds long lookup queries and turns query errors into per-user failures', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      user(String(i), {
        account: {
          lookup: {
            sobject: 'Account',
            field: 'External__c',
            value: { value: `${i}${"'".repeat(1000)}` },
          },
        },
      })
    );
    const query = sinon.stub().resolves({ records: [] });
    await resolveRelatedContext(contextOptions(entries, query));
    expect(query.callCount).to.be.greaterThan(1);
    for (const call of query.getCalls()) expect(String(call.args[0]).length).to.be.at.most(18000);
    query.rejects(new Error('lookup unavailable'));
    const result = await resolveRelatedContext(contextOptions([entries[0]], query));
    expect(result.get(0)?.errors.join(' ')).to.include('lookup unavailable');
  });

  it('rejects oversized escaped lookup values while resolving valid users in the same group', async () => {
    const oversized = "'".repeat(9000);
    const lookupUser = (name: string, value: string) =>
      user(name, { account: { lookup: { sobject: 'Account', field: 'External__c', value: { value } } } });
    const query = sinon.stub().resolves({ records: [{ Id: '001', External__c: 'valid' }] });
    const result = await resolveRelatedContext(
      contextOptions([lookupUser('a', oversized), lookupUser('b', 'valid'), lookupUser('c', oversized)], query)
    );
    expect(query.callCount).to.equal(1);
    expect(query.firstCall.args[0]).to.equal("SELECT Id, External__c FROM Account WHERE External__c IN ('valid')");
    for (const order of [0, 2]) {
      expect(result.get(order)?.errors).to.deep.equal(['errorInvalidLookup']);
      expect(result.get(order)?.values).not.to.have.property('account');
    }
    expect(result.get(1)?.errors).to.deep.equal([]);
    expect(result.get(1)?.values.account).to.equal('001');
    query.resetHistory();
    await resolveRelatedContext(contextOptions([lookupUser('a', oversized)], query));
    expect(query.called).to.equal(false);
  });

  it('accepts the exact query budget and rejects oversized single values before and after a batch', () => {
    const prefix = 'SELECT Id FROM Account WHERE External__c IN (';
    const boundary = 'a'.repeat(18000 - prefix.length - 3);
    expect(matchQueryBatches([boundary], prefix)).to.deep.equal([[boundary]]);
    for (const values of [[`${boundary}a`], ['valid', `${boundary}a`]])
      expect(() => matchQueryBatches(values, prefix)).to.throw(RangeError, 'query budget');
  });

  for (const legacy of [false, true]) {
    it(`isolates before failures and retains real results after User failures (${
      legacy ? 'legacy' : 'callable'
    })`, async () => {
      const fake = fakeConnection(true);
      const execute = async (conn: never, doc: ReturnType<typeof usersDoc>) =>
        legacy
          ? new ProvisionUserUseCase().execute({
              connection: conn,
              usersDoc: doc,
              relatedDoc: catalog,
              personasSupplied: false,
              fuzzyUsername: false,
              dryRun: false,
            })
          : provision.apply(
              conn,
              await provision.plan(conn, {
                usersDoc: doc,
                relatedDoc: catalog,
                personasSupplied: false,
                fuzzyUsername: false,
              })
            );
      const result = await execute(fake.conn, usersDoc(3));
      expect(fake.userCreate.firstCall.args[0]).to.have.length(2);
      expect(result.users[1].status).to.equal('failed');
      expect(result.users[1].relatedRecords?.[0].status).to.equal('failed');
      const failed = fakeConnection(false, true);
      const failure = await execute(failed.conn, usersDoc());
      expect(failure.users[0].relatedRecords?.[0].action).to.equal('created');
      expect(failure.users[0].status).to.equal('failed');
    });
  }
});
