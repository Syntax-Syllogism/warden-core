#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(root, 'schemas');
const schemaBaseUrl = 'https://raw.githubusercontent.com/Syntax-Syllogism/warden-core/release/schemas';

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortKeys(item)])
  );
};

const schemaModules = [
  ['persona-definitions', 'personaDefinitions', 'personaDefinitionsFileSchema'],
  ['users-definition', 'usersDefinition', 'usersDefinitionFileSchema'],
  ['related-catalog', 'relatedCatalog', 'relatedCatalogSchema'],
  ['snapshot', 'snapshot', 'snapshotFileSchema'],
  ['conformance-fixture', 'conformanceFixture', 'conformanceFixtureSchema'],
];

await mkdir(outputDirectory, { recursive: true });
for (const [name, moduleName, exportName] of schemaModules) {
  const module = await import(pathToFileURL(join(root, 'lib', 'spec', `${moduleName}.js`)));
  const schema = module[exportName];
  const document = {
    ...z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    $id: `${schemaBaseUrl}/${name}.schema.json`,
    title: `Warden ${name.replaceAll('-', ' ')} schema`,
    description: schema.description ?? `Warden ${name.replaceAll('-', ' ')} file format.`,
  };
  await writeFile(
    join(outputDirectory, `${name}.schema.json`),
    `${JSON.stringify(sortKeys(document), null, 2)}\n`,
    'utf8'
  );
}
