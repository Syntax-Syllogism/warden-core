import { detectInputFormat, readCsvUsers, type InputFormat } from '../shared/csv.js';
import { readJsonOrThrow } from '../shared/sfUtils.js';
import type { UserFieldMeta } from '../matching/index.js';
import { parsePersonaDefinitions, parseRelatedCatalog, parseUsersDefinition } from '../spec/parse.js';
import { findFirstUserWithPersonas } from './planner.js';
import { DefinitionError } from './errors.js';
import { provisioningMessage } from './messages.js';

export type ProvisionDefinitionDocuments = {
  usersDoc: Record<string, unknown>;
  personasDoc: Record<string, unknown>;
  personasSupplied: boolean;
  /** Parsed `--related-def` catalog document, when one was supplied. JSON only. */
  relatedDoc?: Record<string, unknown>;
};

export type DefinitionMessages = {
  invalidPersonaDefinition: () => string;
  personasWithoutDefinition: (userKey: string) => string;
  invalidJson: (path: string, error: string) => string;
};

const defaultDefinitionMessages: DefinitionMessages = {
  invalidPersonaDefinition: () => provisioningMessage('errorInvalidPersonaDefinition'),
  personasWithoutDefinition: (userKey) => provisioningMessage('errorPersonasWithoutDefinition', [userKey]),
  invalidJson: (path, error) => provisioningMessage('errorInvalidJson', [path, error]),
};

export type DefinitionSource = {
  usersDoc?: Record<string, unknown>;
  personasDoc?: Record<string, unknown>;
  usersPath?: string;
  personasPath?: string;
  relatedDoc?: Record<string, unknown>;
  relatedPath?: string;
  personasSupplied?: boolean;
  inputFormat?: InputFormat;
  csvListDelimiter?: string;
};

export type DefinitionReaderOptions = {
  inputFormat?: InputFormat;
  csvListDelimiter?: string;
  fieldMap?: Map<string, UserFieldMeta>;
  relatedPath?: string;
};

type JsonErrorMessage = (filePath: string, error: string) => string;

const defaultJsonErrorMessage: JsonErrorMessage = (filePath, error) =>
  provisioningMessage('errorInvalidJson', [filePath, error]);

const readDefinitionJson = async (path: string, message: JsonErrorMessage): Promise<Record<string, unknown>> =>
  (await readJsonOrThrow(path, message)) as Record<string, unknown>;

export const assertValidDefinitions = (
  usersDoc: Record<string, unknown>,
  personasDoc: Record<string, unknown>,
  personasSupplied: boolean,
  message: DefinitionMessages = defaultDefinitionMessages
): void => {
  const users = parseUsersDefinition(usersDoc);
  parsePersonaDefinitions(personasDoc);
  const firstUserWithPersonas = personasSupplied === false ? findFirstUserWithPersonas(users.users) : undefined;
  if (firstUserWithPersonas) {
    throw new DefinitionError(
      'errorPersonasWithoutDefinition',
      message.personasWithoutDefinition(firstUserWithPersonas)
    );
  }
};

export const readUsersDefinition = async (
  path: string,
  options: DefinitionReaderOptions = {},
  jsonErrorMessage: JsonErrorMessage = defaultJsonErrorMessage
): Promise<Record<string, unknown>> => {
  if (detectInputFormat(path, options.inputFormat) === 'json')
    return parseUsersDefinition(await readDefinitionJson(path, jsonErrorMessage));
  if (!options.fieldMap) {
    throw new DefinitionError(
      'errorMissingUserFieldMap',
      'A User field map is required to read CSV user definitions.',
      { path }
    );
  }
  return readCsvUsers(path, options.fieldMap, options.csvListDelimiter);
};

export const readProvisionDefinitions = async (
  usersPath: string,
  personasPath?: string,
  options: DefinitionReaderOptions = {},
  jsonErrorMessage: JsonErrorMessage = defaultJsonErrorMessage
): Promise<ProvisionDefinitionDocuments> => {
  const relatedDoc = options.relatedPath
    ? parseRelatedCatalog(await readDefinitionJson(options.relatedPath, jsonErrorMessage))
    : undefined;
  return {
    usersDoc: await readUsersDefinition(usersPath, options, jsonErrorMessage),
    personasDoc: personasPath
      ? parsePersonaDefinitions(await readDefinitionJson(personasPath, jsonErrorMessage))
      : { personas: {} },
    personasSupplied: Boolean(personasPath),
    // Omit the key entirely when no catalog was supplied so callers (and deep-equality
    // assertions) never see an own property holding `undefined`.
    ...(relatedDoc ? { relatedDoc } : {}),
  };
};

export const resolveDefinitions = async (
  source: DefinitionSource,
  fieldMap: Map<string, UserFieldMeta>,
  message: DefinitionMessages = defaultDefinitionMessages
): Promise<ProvisionDefinitionDocuments> => {
  if (source.usersDoc) {
    const relatedDoc =
      source.relatedDoc ??
      (source.relatedPath
        ? parseRelatedCatalog(await readDefinitionJson(source.relatedPath, message.invalidJson))
        : undefined);
    return {
      usersDoc: source.usersDoc,
      personasDoc: source.personasDoc ?? { personas: {} },
      personasSupplied: source.personasSupplied ?? (source.personasDoc ? true : Boolean(source.personasPath)),
      ...(relatedDoc ? { relatedDoc } : {}),
    };
  }
  if (!source.usersPath)
    throw new DefinitionError('errorInvalidJson', message.invalidJson('users-def', 'missing path'));
  return readProvisionDefinitions(
    source.usersPath,
    source.personasPath,
    {
      inputFormat: source.inputFormat,
      csvListDelimiter: source.csvListDelimiter,
      fieldMap,
      relatedPath: source.relatedPath,
    },
    message.invalidJson
  );
};

export const loadValidatedDefinitions = async (
  source: DefinitionSource,
  fieldMap: Map<string, UserFieldMeta>,
  message: DefinitionMessages = defaultDefinitionMessages
): Promise<ProvisionDefinitionDocuments> => {
  if (source.usersDoc) {
    assertValidDefinitions(
      source.usersDoc,
      source.personasDoc ?? { personas: {} },
      source.personasSupplied ?? Boolean(source.personasDoc),
      message
    );
  }
  const definitions = await resolveDefinitions(source, fieldMap, message);
  const usersDoc = parseUsersDefinition(definitions.usersDoc);
  const personasDoc = parsePersonaDefinitions(definitions.personasDoc);
  assertValidDefinitions(usersDoc, personasDoc, source.personasSupplied ?? definitions.personasSupplied, message);
  return { ...definitions, usersDoc, personasDoc };
};
