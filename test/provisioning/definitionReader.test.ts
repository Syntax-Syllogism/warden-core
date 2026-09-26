import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import {
  assertValidDefinitions,
  loadValidatedDefinitions,
  readProvisionDefinitions,
  resolveDefinitions,
  type DefinitionMessages,
} from '../../src/provisioning/definitionReader.js';
import { DefinitionError } from '../../src/provisioning/errors.js';
import { buildFieldMap } from '../../src/provisioning/planner.js';

const messages: DefinitionMessages = {
  invalidPersonaDefinition: () => 'invalid persona definition',
  personasWithoutDefinition: (userKey) => `personas missing for ${userKey}`,
  invalidJson: (path, error) => `invalid JSON in ${path}: ${error}`,
};

describe('definition reader', () => {
  it('reports schema issues before semantic definition checks', () => {
    expect(() => assertValidDefinitions({ users: [] }, { personas: [] }, true, messages)).to.throw(
      'personas: Invalid input'
    );
    expect(() =>
      assertValidDefinitions(
        { users: [{ personas: ['ops'], FederationIdentifier: 'A001' }] },
        { personas: {} },
        false,
        messages
      )
    ).to.throw('personas missing for A001');
  });

  it('validates supplied documents before returning them', async () => {
    try {
      await loadValidatedDefinitions(
        {
          usersDoc: { users: [{ personas: ['ops'], FederationIdentifier: 'A001' }] },
          personasSupplied: false,
        },
        new Map(),
        messages
      );
      expect.fail('Expected missing persona definitions to be rejected');
    } catch (error) {
      expect(error).to.have.property('message', 'personas missing for A001');
    }
  });

  it('defaults missing persona documents for profile-only definitions', async () => {
    const definitions = await loadValidatedDefinitions(
      { usersDoc: { users: [{ Email: 'first@example.test' }] } },
      new Map(),
      messages
    );

    expect(definitions.personasDoc).to.deep.equal({ personas: {} });
    expect(definitions.personasSupplied).to.equal(false);
  });

  it('resolves file-backed definitions through the shared loader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'warden-definition-reader-'));
    const usersPath = join(directory, 'users.json');
    const personasPath = join(directory, 'personas.json');
    try {
      await writeFile(usersPath, JSON.stringify({ users: [{ FederationIdentifier: 'A001' }] }));
      await writeFile(personasPath, JSON.stringify({ personas: { ops: {} } }));

      const definitions = await resolveDefinitions({ usersPath, personasPath }, new Map(), messages);

      expect(definitions).to.deep.equal({
        usersDoc: { users: [{ FederationIdentifier: 'A001' }] },
        personasDoc: { personas: { ops: {} } },
        personasSupplied: true,
      });

      const csvPath = join(directory, 'users.csv');
      await writeFile(csvPath, 'Email\nfirst@example.test\n');
      const csvDefinitions = await resolveDefinitions(
        { usersPath: csvPath, inputFormat: 'csv' },
        buildFieldMap([{ name: 'Email', createable: true, updateable: true, filterable: true }]),
        messages
      );
      expect(csvDefinitions).to.deep.equal({
        usersDoc: { users: [{ Email: 'first@example.test' }] },
        personasDoc: { personas: {} },
        personasSupplied: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('validates persona files when reading provision definitions directly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'warden-definition-reader-'));
    const usersPath = join(directory, 'users.json');
    const personasPath = join(directory, 'personas.json');
    try {
      await writeFile(usersPath, JSON.stringify({ users: [] }));
      await writeFile(personasPath, JSON.stringify({ schemaVersion: 2, personas: {} }));

      try {
        await readProvisionDefinitions(usersPath, personasPath);
        expect.fail('Expected an unsupported persona schema version to be rejected');
      } catch (error) {
        expect(error).to.be.instanceOf(DefinitionError);
        expect((error as DefinitionError).code).to.equal('schema-version-unsupported');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('validates related catalogs when reading provision definitions directly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'warden-definition-reader-'));
    const usersPath = join(directory, 'users.json');
    const relatedPath = join(directory, 'related.json');
    try {
      await writeFile(usersPath, JSON.stringify({ users: [] }));
      await writeFile(relatedPath, JSON.stringify({ schemaVersion: 2, relationships: {} }));

      try {
        await readProvisionDefinitions(usersPath, undefined, { relatedPath });
        expect.fail('Expected an unsupported related-catalog schema version to be rejected');
      } catch (error) {
        expect(error).to.be.instanceOf(DefinitionError);
        expect((error as DefinitionError).code).to.equal('schema-version-unsupported');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
