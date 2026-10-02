import { esc } from '../shared/sfUtils.js';

const MATCH_QUERY_CHUNK_SIZE = 200;
const MATCH_QUERY_MAX_LENGTH = 18_000;

/** Split IN-list values at Salesforce's count and query-text limits. */
export const matchQueryBatches = (
  values: string[],
  prefix: string,
  onOversizedValue: (value: string) => void = (): void => {
    throw new RangeError(`A lookup value exceeds the ${MATCH_QUERY_MAX_LENGTH}-character query budget.`);
  }
): string[][] => {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentLength = prefix.length + 1; // Closing parenthesis.
  for (const value of values) {
    const renderedLength = `'${esc(value)}'`.length;
    if (prefix.length + 1 + renderedLength > MATCH_QUERY_MAX_LENGTH) {
      onOversizedValue(value);
      continue;
    }
    const nextLength = currentLength + (current.length > 0 ? 1 : 0) + renderedLength;
    if (current.length > 0 && (current.length === MATCH_QUERY_CHUNK_SIZE || nextLength > MATCH_QUERY_MAX_LENGTH)) {
      batches.push(current);
      current = [];
      currentLength = prefix.length + 1;
    }
    current.push(value);
    currentLength += (current.length > 1 ? 1 : 0) + renderedLength;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};
