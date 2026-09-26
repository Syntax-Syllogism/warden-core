/**
 * Catalog, plan, and result shapes for `--related-def` relationships.
 *
 * `phase` is typed as the full union even though v1 only accepts `'after'`, so
 * adding `'before'` support later is a validator change rather than a type change.
 */
export type {
  RelatedCatalog,
  RelationshipDef,
  RelationshipMode,
  RelationshipPhase,
  SourceExpr,
} from '../spec/relatedCatalog.js';
import type { RelationshipMode } from '../spec/relatedCatalog.js';

/** A source expression parsed into the shape the resolver dispatches on. */
export type ParsedSource =
  | { kind: 'userId' }
  | { kind: 'userField'; field: string }
  | { kind: 'context'; name: string }
  | { kind: 'invalid' };

export type RelatedRecordPlan = {
  relationship: string;
  phase: 'after';
  sobject: string;
  matchField: string;
  matchValue?: string;
  existingId?: string;
  existingValues?: Record<string, unknown>;
  fields: Record<string, unknown>;
  pendingUserIdFields: string[];
  recordTypeId?: string;
  mode: RelationshipMode;
  status: 'planned' | 'skipped' | 'failed';
  errors: string[];
};

export type RelatedRecordResult = {
  relationship: string;
  phase: 'after';
  sobject: string;
  recordId?: string;
  action: 'created' | 'updated' | 'matched' | 'skipped' | 'wouldCreate' | 'wouldUpdate' | 'wouldSkip';
  status: 'applied' | 'planned' | 'skipped' | 'failed';
  detail?: string;
  error?: string;
};

export type RelatedMessage = (key: string, args?: string[]) => string;
