import type { Connection } from '@salesforce/core';
import type { CanonicalizedUser, UserFieldMeta } from '../provisioning/planner.js';
import { relatedContextValueSchema } from '../spec/usersDefinition.js';
import { describeSobject, type SobjectDescribeCache } from '../shared/userFields.js';
import { soqlIn } from '../shared/sfUtils.js';
import { isEligibleLookupField } from './preflight.js';
import { matchQueryBatches } from './queries.js';
import { isAbsent, parseSource, resolveSource } from './sources.js';
import { relatedRecordsMessage } from './messages.js';
import type { RelatedCatalog, RelatedMessage } from './types.js';

type ContextResult = { values: Record<string, unknown>; errors: string[]; errorsByName: Map<string, string[]> };

const addContextError = (result: ContextResult, name: string, error: string): void => {
  result.errors.push(error);
  result.errorsByName.set(name, [...(result.errorsByName.get(name) ?? []), error]);
};
type LookupRequest = { order: number; name: string; value: string };

type ContextOptions = {
  conn: Connection;
  users: Array<{ order: number; user: CanonicalizedUser }>;
  catalog: RelatedCatalog;
  userFieldMap: Map<string, UserFieldMeta>;
  cache: SobjectDescribeCache;
  message?: RelatedMessage;
};
type LookupGroup = { sobject: string; field: string; requests: LookupRequest[] };

const collectContextRequests = (
  options: ContextOptions,
  results: Map<number, ContextResult>
): Map<string, LookupGroup> => {
  const { users, catalog, userFieldMap, message = relatedRecordsMessage } = options;
  const groups = new Map<string, LookupGroup>();
  for (const { order, user } of users) {
    const result: ContextResult = { values: {}, errors: [], errorsByName: new Map() };
    results.set(order, result);
    const names = new Set(
      (user.related ?? []).flatMap((name) =>
        Object.values(catalog.relationships[name]?.fields ?? {}).flatMap((expr) => {
          const parsed = 'from' in expr ? parseSource(expr.from) : undefined;
          return parsed?.kind === 'context' ? [parsed.name] : [];
        })
      )
    );
    for (const name of names) {
      if (!Object.hasOwn(user.relatedContext ?? {}, name)) {
        addContextError(result, name, message('errorUnknownContextName', [user.inputKey, name]));
        continue;
      }
      const raw = user.relatedContext?.[name];
      const parsed = relatedContextValueSchema.safeParse(raw);
      if (!parsed.success) {
        addContextError(result, name, message('errorInvalidLookup', [name]));
        continue;
      }
      if (typeof parsed.data !== 'object' || parsed.data === null) {
        Object.defineProperty(result.values, name, { value: parsed.data, enumerable: true, configurable: true });
        continue;
      }
      const lookup = parsed.data.lookup;
      const source = 'from' in lookup.value ? parseSource(lookup.value.from) : undefined;
      if (source !== undefined && (source.kind !== 'userField' || !userFieldMap.has(source.field.toLowerCase()))) {
        addContextError(result, name, message('errorInvalidLookup', [name]));
        continue;
      }
      const resolved = resolveSource(lookup.value, {
        relationship: name,
        fieldName: 'lookup.value',
        userFields: user.fields,
        userFieldMap,
      });
      if (resolved.error !== undefined || isAbsent(resolved.value)) {
        addContextError(result, name, message('errorInvalidLookup', [name]));
        continue;
      }
      const key = `${lookup.sobject.toLowerCase()}|${lookup.field.toLowerCase()}`;
      const group = groups.get(key) ?? { sobject: lookup.sobject, field: lookup.field, requests: [] };
      group.requests.push({ order, name, value: String(resolved.value) });
      groups.set(key, group);
    }
  }
  return groups;
};

/** Resolve only selected relationships' context names, batching lookup values across users. */
export const resolveRelatedContext = async (options: ContextOptions): Promise<Map<number, ContextResult>> => {
  const { conn, cache, message = relatedRecordsMessage } = options;
  const results = new Map<number, ContextResult>();
  const groups = collectContextRequests(options, results);
  for (const group of groups.values()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const described = await describeSobject(conn, group.sobject, cache);
      const meta = described.fields.get(group.field.toLowerCase());
      if (!described.queryable || !isEligibleLookupField(meta)) {
        for (const request of group.requests)
          addContextError(
            results.get(request.order)!,
            request.name,
            message('errorLookupFieldIneligible', [group.field, group.sobject])
          );
        continue;
      }
      const field = meta!.name;
      const prefix = `SELECT Id, ${field} FROM ${described.name} WHERE ${field} IN (`;
      const rejected = new Set<string>();
      const chunks = matchQueryBatches([...new Set(group.requests.map((r) => r.value))], prefix, (value) => {
        rejected.add(value);
        for (const request of group.requests.filter((r) => r.value === value))
          addContextError(results.get(request.order)!, request.name, message('errorInvalidLookup', [request.name]));
      });
      group.requests = group.requests.filter((r) => !rejected.has(r.value));
      const requests = chunks.map(
        async (chunk) => (await conn.query<Record<string, unknown>>(`${prefix}${soqlIn(chunk)})`)).records
      );
      // eslint-disable-next-line no-await-in-loop
      const rows = (await Promise.all(requests)).flat();
      const normalize = (value: unknown): string =>
        meta?.caseSensitive === false ? String(value).toLowerCase() : String(value);
      const index = new Map<string, Array<Record<string, unknown>>>();
      for (const row of rows) index.set(normalize(row[field]), [...(index.get(normalize(row[field])) ?? []), row]);
      for (const request of group.requests) {
        const matches = index.get(normalize(request.value)) ?? [];
        const result = results.get(request.order)!;
        if (matches.length === 1 && matches[0].Id)
          Object.defineProperty(result.values, request.name, {
            value: matches[0].Id,
            enumerable: true,
            configurable: true,
          });
        else
          addContextError(
            result,
            request.name,
            message(matches.length > 1 ? 'errorLookupAmbiguous' : 'errorLookupNotFound', [request.name, request.value])
          );
      }
    } catch (error) {
      for (const request of group.requests)
        addContextError(
          results.get(request.order)!,
          request.name,
          `Context lookup "${request.name}" failed: ${error instanceof Error ? error.message : String(error)}`
        );
    }
  }
  return results;
};
