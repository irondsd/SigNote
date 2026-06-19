'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import {
  cancelAndSnapshot,
  filterOut,
  insertAtTop,
  patchInPlace,
  toggleArchive,
  restoreSnapshots,
  invalidateSnapshots,
  type WithId,
  type Snapshot,
} from '@/lib/queryCache';
import { registerStableKey } from '@/lib/stableKeyStore';
import { versionsKey, type VersionTier } from '@/hooks/useVersions';

type DeleteFn = (id: string) => Promise<unknown>;
type UndeleteFn<T> = (args: { id: string; note: T }) => Promise<unknown>;
type UpdateInput = { id: string; archived?: boolean; [key: string]: unknown };
type UpdateFn = (input: UpdateInput) => Promise<unknown>;
type CreateInput = { title: string; color?: string | null; pattern?: string | null; tags?: string[] };

function settledHandler<T>(qc: ReturnType<typeof useQueryClient>, root: string) {
  return (_data: unknown, _err: unknown, _vars: unknown, context?: { snapshots: Snapshot<T>[] }) => {
    if (context?.snapshots?.length) return invalidateSnapshots(qc, context.snapshots);
    return qc.invalidateQueries({ queryKey: [root] });
  };
}

/** The query root is the plural tier ('notes'); analytics/toasts want the singular ('note'). */
const singular = (root: string) => root.replace(/s$/, '');

/**
 * The fields every tier's optimistic temp note shares. Each tier spreads this
 * and adds its own body shape (content / encryptedBody / wrappedNoteKey).
 */
export function commonTempNote(input: CreateInput, tempId: string) {
  const now = new Date().toISOString();
  return {
    _id: tempId,
    title: input.title,
    archived: false,
    deletedAt: null,
    position: -1,
    createdAt: now,
    updatedAt: now,
    color: input.color ?? null,
    pattern: input.pattern ?? null,
    pinned: false,
    expiresAt: null,
    burnAfterReading: false,
    tags: input.tags ?? [],
  };
}

/**
 * Shared optimistic-create mutation: snapshot, insert a temp note at the top,
 * adopt the real id on success, and recover the cache (with a sticky toast) on
 * failure. Tiers supply only the api call and the temp-note builder.
 */
export function useCreateTier<T extends WithId, TInput>(
  root: string,
  mutationFn: (input: TInput) => Promise<T>,
  buildTempNote: (input: TInput, tempId: string) => T,
  callbacks?: { onError?: (vars: TInput) => void },
) {
  const qc = useQueryClient();
  const tierName = singular(root);
  return useMutation({
    mutationFn,
    onMutate: async (input: TInput) => {
      const snapshots = await cancelAndSnapshot<T>(qc, root);
      const tempId = `temp-${Date.now()}`;
      insertAtTop(qc, snapshots, buildTempNote(input, tempId));
      return { snapshots, tempId };
    },
    onSuccess: (data, _vars, context) => {
      if (data?._id && context?.tempId) registerStableKey(data._id, context.tempId);
      posthog.capture(`${tierName}_created`);
    },
    onError: (_err, vars, context) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: tierName, operation: 'create' });
      toast.error(`Failed to create ${tierName}`, {
        description: 'Your content has been recovered.',
        duration: Infinity,
      });
      callbacks?.onError?.(vars);
    },
    onSettled: settledHandler<T>(qc, root),
  });
}

export function useDeleteTier<T extends WithId>(root: string, apiFn: DeleteFn) {
  const qc = useQueryClient();
  const tierName = singular(root);
  return useMutation({
    mutationFn: apiFn,
    onMutate: async (id: string) => {
      const snapshots = await cancelAndSnapshot<T>(qc, root);
      filterOut(qc, snapshots, id);
      return { snapshots };
    },
    onSuccess: () => {
      posthog.capture(`${tierName}_deleted`);
    },
    onError: (_err: unknown, _id: string, context?: { snapshots: Snapshot<T>[] }) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: tierName, operation: 'delete' });
      toast.error(`Failed to delete ${tierName}`);
    },
    onSettled: settledHandler<T>(qc, root),
  });
}

export function useUndeleteTier<T extends WithId>(root: string, apiFn: UndeleteFn<T>) {
  const qc = useQueryClient();
  const tierName = singular(root);
  return useMutation({
    mutationFn: apiFn,
    onMutate: async ({ note }: { id: string; note: T }) => {
      const snapshots = await cancelAndSnapshot<T>(qc, root);
      insertAtTop(qc, snapshots, { ...note, deletedAt: null } as T);
      return { snapshots };
    },
    onError: (_err: unknown, _vars: { id: string; note: T }, context?: { snapshots: Snapshot<T>[] }) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      toast.error(`Failed to restore ${tierName}`);
    },
    onSettled: settledHandler<T>(qc, root),
  });
}

export function useUpdateTier<T extends WithId>(root: string, apiFn: UpdateFn, contentField: string) {
  const qc = useQueryClient();
  const tierName = singular(root);
  return useMutation({
    mutationFn: apiFn,
    onMutate: async ({ id, archived, ...rest }: UpdateInput) => {
      const snapshots = await cancelAndSnapshot<T>(qc, root);
      const patch = { ...rest, updatedAt: new Date().toISOString() } as unknown as Partial<T>;
      if (archived !== undefined) {
        toggleArchive(qc, snapshots, id, archived, patch);
      } else {
        patchInPlace(qc, snapshots, id, patch);
      }
      return { snapshots };
    },
    onSuccess: (_data: unknown, vars: UpdateInput) => {
      if (vars.archived !== undefined) {
        posthog.capture(`${tierName}_archived`, { archived: vars.archived });
      } else if (vars.title !== undefined || vars[contentField] !== undefined) {
        posthog.capture(`${tierName}_updated`);
      }
    },
    onError: (_err: unknown, _vars: UpdateInput, context?: { snapshots: Snapshot<T>[] }) => {
      if (context) restoreSnapshots(qc, context.snapshots);
      posthog.capture('mutation_failed', { tier: tierName, operation: 'update' });
      toast.error(`Failed to save ${tierName}`);
    },
    onSettled: (data: unknown, err: unknown, vars: UpdateInput, context?: { snapshots: Snapshot<T>[] }) => {
      // A title/content edit may have pushed a version snapshot server-side —
      // drop the cached timeline so an open/reopened history panel refetches.
      if (vars.title !== undefined || vars[contentField] !== undefined) {
        void qc.invalidateQueries({ queryKey: versionsKey(root as VersionTier, vars.id) });
      }
      return settledHandler<T>(qc, root)(data, err, vars, context);
    },
  });
}
