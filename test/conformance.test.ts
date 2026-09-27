import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect } from 'chai';
import { planFromState } from '../src/provisioning/conformancePlan.js';
import { parseConformanceFixture } from '../src/spec/parse.js';
import type { ConformanceFixture } from '../src/spec/conformanceFixture.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '../conformance/fixtures');

const readFixtures = async (): Promise<Array<{ name: string; fixture: ConformanceFixture }>> => {
  const names = (await readdir(fixtureDirectory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      fixture: parseConformanceFixture(JSON.parse(await readFile(join(fixtureDirectory, name), 'utf8')) as unknown),
    }))
  );
};

describe('conformance fixtures', () => {
  it('validates and matches every canonical v1 fixture', async () => {
    const fixtures = await readFixtures();
    expect(fixtures).to.have.length(8);
    for (const { name, fixture } of fixtures) {
      expect(planFromState(fixture.definitions, fixture.orgState), name).to.deep.equal(fixture.expectedPlan);
    }
  });

  it('validates every fixture with the generated JSON Schema', async () => {
    const schema = JSON.parse(
      await readFile(join(fixtureDirectory, '../../schemas/conformance-fixture.schema.json'), 'utf8')
    ) as object;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const fixtures = await readFixtures();
    const rawFixtures = await Promise.all(fixtures.map(({ name }) => readFile(join(fixtureDirectory, name), 'utf8')));
    rawFixtures.forEach((raw, index) => {
      expect(validate(JSON.parse(raw) as unknown), fixtures[index].name).to.equal(true);
    });
  });

  it('does not let a no-op harness pass a fixture with planned work', async () => {
    const fixture = (await readFixtures()).find(({ name }) => name === '01-single-persona.json');
    expect(fixture).to.not.equal(undefined);
    if (!fixture) return;
    expect(fixture.fixture.expectedPlan).to.have.length.greaterThan(0);
    expect(planFromState(fixture.fixture.definitions, fixture.fixture.orgState)).to.not.deep.equal([]);
  });

  it('matches live resolver keys for each setup-object category', async () => {
    const fixture = (await readFixtures()).find(({ name }) => name === '08-category-specific-reference-keys.json');
    expect(fixture).to.not.equal(undefined);
    if (!fixture) return;
    expect(planFromState(fixture.fixture.definitions, fixture.fixture.orgState)).to.deep.equal(
      fixture.fixture.expectedPlan
    );
  });
});
