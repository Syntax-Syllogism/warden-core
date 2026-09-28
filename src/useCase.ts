import type { Connection } from '@salesforce/core';
import { z } from 'zod';
import { WardenError } from './errors.js';

export type ProgressEvent = {
  phase: string;
  done?: number;
  total?: number;
  message?: string;
};

export type UseCaseContext = {
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
};

export type UiHint = {
  kind: 'file' | 'string' | 'boolean' | 'enum';
  label: string;
  summary?: string;
  placeholder?: string;
  fileFilter?: 'json' | 'csv' | 'json-or-csv';
  /** The caller asks for exactly one option in the group. */
  exclusiveGroup?: string;
  dependsOn?: string;
};

export type CommandId = 'provision' | 'access' | 'diff' | 'freeze' | 'unfreeze' | 'strip' | 'snapshot' | 'restore';

export type CommandDescriptor<O> = {
  id: CommandId;
  title: string;
  group: 'User Lifecycle';
  destructive: boolean;
  optionsSchema: z.ZodType<O>;
};

export type ReadUseCase<O, R> = {
  kind: 'read';
  descriptor: CommandDescriptor<O>;
  run(conn: Connection, options: O, ctx?: UseCaseContext): Promise<R>;
};

export type WriteUseCase<O, P, R> = {
  kind: 'write';
  descriptor: CommandDescriptor<O>;
  plan(conn: Connection, options: O, ctx?: UseCaseContext): Promise<P>;
  apply(conn: Connection, plan: P, ctx?: UseCaseContext): Promise<R>;
};

export type UseCase<O, R> = ReadUseCase<O, R> | WriteUseCase<O, unknown, R>;

export const uiHints = <O>(schema: z.ZodType<O>): Record<string, UiHint> => {
  if (!(schema instanceof z.ZodObject)) return {};
  return Object.fromEntries(
    Object.entries(schema.shape).flatMap(([key, field]) => {
      let current: unknown = field;
      let meta: { ui?: UiHint } | undefined;
      while (current != null) {
        const candidate = current as { meta?: () => { ui?: UiHint }; unwrap?: () => unknown };
        meta = candidate.meta?.();
        if (meta?.ui ?? !candidate.unwrap) break;
        current = candidate.unwrap();
      }
      return meta?.ui ? [[key, meta.ui]] : [];
    })
  );
};

export const checkCancelled = (ctx?: UseCaseContext): void => {
  if (ctx?.signal?.aborted) throw new WardenError('cancelled', 'Operation cancelled.');
};

export const startProgress = (ctx?: UseCaseContext, phase = 'start'): void => {
  checkCancelled(ctx);
  ctx?.onProgress?.({ phase });
};

export const endProgress = (ctx?: UseCaseContext, phase = 'complete'): void => {
  checkCancelled(ctx);
  ctx?.onProgress?.({ phase });
};
