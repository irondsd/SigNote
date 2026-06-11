import { MAX_VERSIONS, VERSION_COMPRESSION_WINDOW_MS } from '@/config/constants';

type VersionLike = { createdAt: Date };
type VersionableDoc = { versions?: VersionLike[] };

/**
 * Builds the `$push` update fragment that records a pre-edit snapshot, with two
 * behaviours baked in:
 *
 *  - Compression: if the snapshot was saved within VERSION_COMPRESSION_WINDOW_MS
 *    of the previous version, it is suppressed (returns `{}`) so a burst of
 *    saves within one editing session collapses to one version.
 *  - Cap: `$slice: -MAX_VERSIONS` keeps only the newest MAX_VERSIONS entries.
 *
 * Pass the *current* (pre-edit) state of the head as `snapshot`, with
 * `createdAt` set to the head's `updatedAt` — i.e. when that content was
 * saved, not when the displacing edit happened. The caller then writes the
 * new state (and a fresh `updatedAt`) to the head in the same update.
 */
export function buildVersionPush<V extends VersionLike>(
  doc: VersionableDoc,
  snapshot: V,
): { $push: { versions: { $each: V[]; $slice: number } } } | Record<string, never> {
  const versions = doc.versions ?? [];
  const last = versions[versions.length - 1];

  if (last && snapshot.createdAt.getTime() - last.createdAt.getTime() < VERSION_COMPRESSION_WINDOW_MS) {
    return {};
  }

  return {
    $push: {
      versions: { $each: [snapshot], $slice: -MAX_VERSIONS },
    },
  };
}
