/** Catalog, plan, and result shapes for related-record relationships. */
export type {
  RelatedCatalog,
  RelationshipDef,
  RelationshipMode,
  RelationshipPhase,
  SourceExpr,
} from '../spec/relatedCatalog.js';
import type { RelationshipMode, RelationshipPhase } from '../spec/relatedCatalog.js';

/** A source expression parsed into the shape the resolver dispatches on. */
export type ParsedSource =
  | { kind: 'userId' }
  | { kind: 'userField'; field: string }
  | { kind: 'context'; name: string }
  | { kind: 'invalid' };

export type RelatedRecordPlan = {
  relationship: string;
  phase: RelationshipPhase;
  sobject: string;
  linkUser?: { userField: string; fromRelatedField: string };
  linkValue?: unknown;
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
  phase: RelationshipPhase;
  sobject: string;
  recordId?: string;
  action:
    | 'created'
    | 'updated'
    | 'matched'
    | 'skipped'
    | 'wouldCreate'
    | 'wouldUpdate'
    | 'wouldSkip'
    | 'deleted'
    | 'deleteFailed';
  status: 'applied' | 'planned' | 'skipped' | 'failed';
  detail?: string;
  error?: string;
};

export type RelatedMessage = (key: string, args?: string[]) => string;

/** Internal ownership marker for compensating deletes; omitted from public results. */
export type AppliedRelatedRecordResult = RelatedRecordResult & { createdInThisRun?: boolean };
