import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect } from 'chai';
import {
  parsePersonaDefinitions,
  parseRelatedCatalog,
  parseSnapshot,
  parseUsersDefinition,
  safeParsePersonaDefinitions,
  validateUsersDefinitionText,
} from '../../src/spec/parse.js';
import { DefinitionError } from '../../src/provisioning/errors.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/spec');
const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(join(fixtureDirectory, name), 'utf8')) as unknown;

const readFixtures = async (names: string[]): Promise<Record<string, unknown>> =>
  Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFixture(name)] as const)));

describe('file-format schemas', () => {
  it('accepts the copied persona, users, related-catalog, and snapshot corpus', async () => {
    const fixtures = await readFixtures([
      'persona-def.json',
      'personas-example.json',
      'docs-personas.json',
      'user-def.json',
      'users-example.json',
      'users-profile-only.json',
      'related-users.json',
      'matching-users.json',
      'docs-mixed-users.json',
      'docs-basic-users.json',
      'related-catalog.json',
      'snapshot.json',
    ]);
    parsePersonaDefinitions(fixtures['persona-def.json']);
    parsePersonaDefinitions(fixtures['personas-example.json']);
    parsePersonaDefinitions(fixtures['docs-personas.json']);
    parseUsersDefinition(fixtures['user-def.json']);
    parseUsersDefinition(fixtures['users-example.json']);
    parseUsersDefinition(fixtures['users-profile-only.json']);
    parseUsersDefinition(fixtures['related-users.json']);
    parseUsersDefinition(fixtures['matching-users.json']);
    parseUsersDefinition(fixtures['docs-mixed-users.json']);
    parseUsersDefinition(fixtures['docs-basic-users.json']);
    parseRelatedCatalog(fixtures['related-catalog.json']);
    parseSnapshot(fixtures['snapshot.json']);
  });

  it('preserves accepted persona metadata keys such as name and description', async () => {
    const parsed = parsePersonaDefinitions(await readFixture('persona-def.json'));
    expect(parsed.personas.default).to.include({
      name: 'Default Persona',
      description: 'This is the default persona used for general interactions.',
    });
  });

  it('preserves nullable related-catalog defaults accepted by the existing validator', () => {
    expect(() =>
      parseRelatedCatalog({
        relationships: {
          employee: {
            sobject: 'Employee__c',
            phase: 'after',
            recordType: null,
            match: { field: 'External_Id__c', from: 'user.FederationIdentifier' },
            fields: { ['Status__c']: { value: null } },
            mode: null,
          },
        },
      })
    ).not.to.throw();
  });

  it('reports structural issues with stable paths and schema-invalid', () => {
    const result = safeParsePersonaDefinitions({ personas: { ops: { permissionSets: 'not-an-array' } } });
    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.error).to.be.instanceOf(DefinitionError);
    expect(result.error.code).to.equal('schema-invalid');
    expect(result.issues[0]).to.deep.include({ path: ['personas', 'ops', 'permissionSets'] });
  });

  it('rejects newer persona, users, and related schema versions clearly', () => {
    for (const parse of [parsePersonaDefinitions, parseUsersDefinition, parseRelatedCatalog]) {
      expect(() =>
        parse({
          schemaVersion: 2,
          ...(parse === parseRelatedCatalog
            ? { relationships: {} }
            : parse === parsePersonaDefinitions
            ? { personas: {} }
            : { users: [] }),
        })
      ).to.throw(DefinitionError);
      try {
        parse({
          schemaVersion: 2,
          ...(parse === parseRelatedCatalog
            ? { relationships: {} }
            : parse === parsePersonaDefinitions
            ? { personas: {} }
            : { users: [] }),
        });
      } catch (error) {
        expect(error).to.have.property('code', 'schema-version-unsupported');
      }
    }
    expect(() => parseSnapshot({ snapshotVersion: 2, capturedAt: 'now', users: [] })).to.throw(DefinitionError);
  });

  it('accepts legacy version-1 snapshots without capturedAt', () => {
    // The pre-schema reader (assertSnapshotFile) never required capturedAt,
    // so snapshots written without it must stay readable.
    const legacy = {
      snapshotVersion: 1,
      users: [
        {
          match: 'Username',
          matchValue: 'a@example.com',
          userId: '005000000000001AAA',
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
    const parsed = parseSnapshot(legacy);
    expect(parsed.capturedAt).to.equal(undefined);
    expect(parsed.users).to.have.length(1);
  });

  it('does not apply the schemaVersion policy to snapshots', () => {
    expect(
      parseSnapshot({
        snapshotVersion: 1,
        schemaVersion: 2,
        users: [],
      })
    ).to.deep.include({ snapshotVersion: 1, schemaVersion: 2 });
  });

  it('validates JSON text in memory without filesystem access', () => {
    expect(validateUsersDefinitionText('{"users":[]}')).to.include({ ok: true });
    const invalid = validateUsersDefinitionText('{"users":[1]}');
    expect(invalid.ok).to.equal(false);
    if (!invalid.ok) expect(invalid.issues[0].path).to.deep.equal(['users', 0]);
  });

  it('keeps generated JSON Schema validation aligned with Zod for the corpus', async () => {
    const ajv = new Ajv2020({ allErrors: true });
    const cases: Array<[string, string[]]> = [
      ['persona-definitions.schema.json', ['persona-def.json', 'personas-example.json', 'docs-personas.json']],
      [
        'users-definition.schema.json',
        [
          'user-def.json',
          'users-example.json',
          'users-profile-only.json',
          'related-users.json',
          'matching-users.json',
          'docs-mixed-users.json',
          'docs-basic-users.json',
        ],
      ],
      ['related-catalog.schema.json', ['related-catalog.json']],
      ['snapshot.schema.json', ['snapshot.json']],
    ];
    const loadedCases = await Promise.all(
      cases.map(async ([schemaName, fixtureNames]) => ({
        schemaName,
        fixtureNames,
        schema: JSON.parse(
          await readFile(join(dirname(fixtureDirectory), '../../schemas', schemaName), 'utf8')
        ) as object,
        fixtures: await readFixtures(fixtureNames),
      }))
    );
    for (const { schemaName, fixtureNames, schema, fixtures } of loadedCases) {
      const validate = ajv.compile(schema);
      for (const fixtureName of fixtureNames)
        expect(validate(fixtures[fixtureName]), `${schemaName}/${fixtureName}`).to.equal(true);
    }
  });

  it('rejects unsupported schema versions in generated JSON Schemas', async () => {
    const ajv = new Ajv2020();
    const cases: Array<[string, object]> = [
      ['persona-definitions.schema.json', { schemaVersion: 2, personas: {} }],
      ['users-definition.schema.json', { schemaVersion: 2, users: [] }],
      ['related-catalog.schema.json', { schemaVersion: 2, relationships: {} }],
    ];

    const loadedCases = await Promise.all(
      cases.map(async ([schemaName, document]) => ({
        schemaName,
        document,
        schema: JSON.parse(
          await readFile(join(dirname(fixtureDirectory), '../../schemas', schemaName), 'utf8')
        ) as object,
      }))
    );
    for (const { schemaName, document, schema } of loadedCases) {
      const validate = ajv.compile(schema);
      expect(validate(document), schemaName).to.equal(false);
    }
  });
});
