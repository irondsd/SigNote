import { createTarDecoder, createTarPacker, type ParsedTarEntry } from 'modern-tar';

import {
  DEFAULT_VAULT_BACKUP_ENCRYPTION,
  encryptVaultBackupStream,
  type VaultBackupEncryptionOptions,
} from './envelope';
import { chunkSource, readableStreamFromChunks, type VaultBackupChunkSource } from './stream';

export type VaultBackupArchiveEntry = {
  path: string;
  /** Exact byte length of the source. TAR requires this before the entry body. */
  size: number;
  source: VaultBackupChunkSource;
};

export type VaultBackupArchiveStream = {
  readable: ReadableStream<Uint8Array>;
  /** Rejects if entry production or TAR finalisation fails. */
  completed: Promise<void>;
};

export type ParsedVaultBackupArchiveEntry = {
  path: string;
  size: number;
  body: ReadableStream<Uint8Array>;
};

export type VaultBackupArchiveReadLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};

export const DEFAULT_VAULT_BACKUP_ARCHIVE_LIMITS: VaultBackupArchiveReadLimits = {
  maxEntries: 1_000_000,
  maxEntryBytes: 1024 ** 4,
  maxTotalBytes: 4 * 1024 ** 4,
};

export class VaultBackupArchivePathError extends Error {
  constructor(path: string) {
    super(`Unsafe or invalid vault archive path: ${path}`);
    this.name = 'VaultBackupArchivePathError';
  }
}

export class VaultBackupArchiveEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultBackupArchiveEntryError';
  }
}

export function validateVaultBackupArchivePath(path: string): void {
  const segments = path.split('/');
  if (
    path.length === 0 ||
    path.length > 1024 ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    !/^[A-Za-z0-9._/-]+$/.test(path) ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new VaultBackupArchivePathError(path);
  }
}

function validateVaultBackupArchiveSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new VaultBackupArchiveEntryError(`Invalid vault archive entry size: ${size}`);
  }
}

function pathIdentity(path: string): string {
  return path.toLowerCase();
}

function validateArchiveLimits(limits: VaultBackupArchiveReadLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new VaultBackupArchiveEntryError(`Invalid vault archive limit ${name}: ${value}`);
    }
  }
  if (limits.maxEntryBytes > limits.maxTotalBytes) {
    throw new VaultBackupArchiveEntryError('Vault archive per-entry limit exceeds its aggregate limit');
  }
}

function validatePlannedEntries(entries: Iterable<VaultBackupArchiveEntry>): VaultBackupArchiveEntry[] {
  const plannedEntries = Array.from(entries);
  const seen = new Set<string>();
  for (const entry of plannedEntries) {
    validateVaultBackupArchivePath(entry.path);
    validateVaultBackupArchiveSize(entry.size);
    const identity = pathIdentity(entry.path);
    if (seen.has(identity)) throw new VaultBackupArchivePathError(entry.path);
    seen.add(identity);
  }
  return plannedEntries;
}

/**
 * Writes entries sequentially into a standard USTAR/PAX stream. The declared
 * size is checked by the TAR writer, so a source that produces too few or too
 * many bytes fails the export rather than yielding a corrupt archive.
 */
export function createVaultBackupTarStream(entries: Iterable<VaultBackupArchiveEntry>): VaultBackupArchiveStream {
  const plannedEntries = validatePlannedEntries(entries);
  const { readable, controller } = createTarPacker();

  const completed = (async () => {
    try {
      for (const entry of plannedEntries) {
        const body = controller.add({
          name: entry.path,
          size: entry.size,
          type: 'file',
          // Stable metadata keeps identical logical archives reproducible
          // before the randomized encryption envelope is applied.
          mode: 0o600,
          mtime: new Date(0),
          uid: 0,
          gid: 0,
          uname: '',
          gname: '',
        });
        await readableStreamFromChunks(chunkSource(entry.source)).pipeTo(body);
      }
      controller.finalize();
    } catch (error) {
      controller.error(error);
      throw error;
    }
  })();

  return { readable, completed };
}

function validateParsedEntry(
  entry: ParsedTarEntry,
  seen: Set<string>,
  limits: VaultBackupArchiveReadLimits,
  totals: { entries: number; bytes: number },
): ParsedVaultBackupArchiveEntry {
  const { header } = entry;
  validateVaultBackupArchivePath(header.name);
  validateVaultBackupArchiveSize(header.size);
  if (header.type !== 'file') {
    throw new VaultBackupArchiveEntryError(`Unsupported vault archive entry type: ${header.type ?? 'unknown'}`);
  }
  totals.entries += 1;
  totals.bytes += header.size;
  if (totals.entries > limits.maxEntries) {
    throw new VaultBackupArchiveEntryError('Vault archive contains too many entries');
  }
  if (header.size > limits.maxEntryBytes) {
    throw new VaultBackupArchiveEntryError(`Vault archive entry exceeds its byte limit: ${header.name}`);
  }
  if (!Number.isSafeInteger(totals.bytes) || totals.bytes > limits.maxTotalBytes) {
    throw new VaultBackupArchiveEntryError('Vault archive exceeds its aggregate byte limit');
  }
  const identity = pathIdentity(header.name);
  if (seen.has(identity)) throw new VaultBackupArchivePathError(header.name);
  seen.add(identity);
  return { path: header.name, size: header.size, body: entry.body };
}

/**
 * Strictly decodes a TAR stream without buffering entry bodies. Callers must
 * completely read or cancel each body before requesting the next entry.
 */
export function readVaultBackupTarEntries(
  source: VaultBackupChunkSource,
  limits: VaultBackupArchiveReadLimits = DEFAULT_VAULT_BACKUP_ARCHIVE_LIMITS,
): ReadableStream<ParsedVaultBackupArchiveEntry> {
  validateArchiveLimits(limits);
  const decoder = createTarDecoder({ strict: true });
  const seen = new Set<string>();
  const totals = { entries: 0, bytes: 0 };
  return readableStreamFromChunks(chunkSource(source))
    .pipeThrough(decoder)
    .pipeThrough(
      new TransformStream<ParsedTarEntry, ParsedVaultBackupArchiveEntry>({
        transform(entry, controller) {
          controller.enqueue(validateParsedEntry(entry, seen, limits, totals));
        },
      }),
    );
}

export async function createEncryptedVaultBackupArchive(
  entries: Iterable<VaultBackupArchiveEntry>,
  password: string,
  options: VaultBackupEncryptionOptions = DEFAULT_VAULT_BACKUP_ENCRYPTION,
): Promise<VaultBackupArchiveStream> {
  const tar = createVaultBackupTarStream(entries);
  return {
    readable: await encryptVaultBackupStream(tar.readable, password, options),
    completed: tar.completed,
  };
}
