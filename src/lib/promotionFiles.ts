import { decryptFileBytes, encryptFileBytes, encryptSealFileBytes } from '@/lib/crypto';
import { generationHeaders } from '@/lib/encryptionGeneration';

export type PromotionAttachment = {
  _id: string;
  filename: string;
  size: number;
  mimeType: string;
  encrypted: boolean;
};

export type FileReplacement = { sourceId: string; encryptedId: string };

const ATTACHMENT_TAG_RE = /<[a-z]+\b[^>]*\bdata-file-id=(['"])[^'"]+\1[^>]*>/gi;
const FILE_ID_ATTR_RE = /\b(data-file-id|fileid)=(['"])[^'"]*\2/gi;
const KEY_NOTE_ATTR_RE = /\s(?:data-key-note-id|keynoteid)=(['"])[^'"]*\1/gi;

/**
 * Points attachment nodes at their replacement uploads. The editor serializes
 * the id twice — its own `fileid` attribute and `data-file-id` — so both move
 * together. `keyNoteId` marks the replacements as bound to that Seal's key,
 * which is what keeps them from being pasted into another note.
 */
export function replaceFileIds(html: string, replacements: ReadonlyMap<string, string>, keyNoteId?: string): string {
  return html.replace(ATTACHMENT_TAG_RE, (tag) => {
    const current = /\bdata-file-id=(['"])([^'"]+)\1/i.exec(tag)?.[2];
    const next = current ? replacements.get(current) : undefined;
    if (!next) return tag;
    let rebuilt = tag.replace(
      FILE_ID_ATTR_RE,
      (_match, name: string, quote: string) => `${name}=${quote}${next}${quote}`,
    );
    if (keyNoteId) {
      rebuilt = rebuilt.replace(KEY_NOTE_ATTR_RE, '').replace(/\s*(\/?>)$/, ` data-key-note-id="${keyNoteId}"$1`);
    }
    return rebuilt;
  });
}

async function deleteUnlinkedUploads(ids: string[]): Promise<void> {
  await Promise.allSettled(
    ids.map((id) => fetch(`/api/files/${id}`, { method: 'DELETE', headers: generationHeaders() })),
  );
}

type Reencryption = {
  /** The attachment's plaintext, read from its download. */
  read: (download: Response) => Promise<Uint8Array<ArrayBuffer>>;
  encrypt: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ iv: string; cipherBytes: ArrayBuffer }>;
  /** Extra upload fields: the key binding of the replacement. */
  fields?: Record<string, string>;
  keyNoteId?: string;
};

/**
 * Uploads an encrypted replacement for every attachment and rewrites the given
 * contents to point at them. Nothing is linked here: the promotion commit links
 * the replacements and retires the originals in one step, and any failure
 * before that removes the uploads again.
 */
async function reencryptAttachments(
  attachments: PromotionAttachment[],
  contents: string[],
  reencryption: Reencryption,
  onProgress?: (message: string) => void,
): Promise<{ contents: string[]; replacements: FileReplacement[] }> {
  const uploadedIds: string[] = [];
  const replacements = new Map<string, string>();

  try {
    for (const [index, attachment] of attachments.entries()) {
      onProgress?.(`Encrypting attachment ${index + 1} of ${attachments.length}…`);
      const download = await fetch(`/api/files/${attachment._id}`, { headers: generationHeaders() });
      if (!download.ok) throw new Error(`Could not read ${attachment.filename}`);

      const { iv, cipherBytes } = await reencryption.encrypt(await reencryption.read(download));
      const formData = new FormData();
      formData.append('file', new Blob([cipherBytes]), attachment.filename);
      formData.append('originalMimeType', attachment.mimeType);
      formData.append('originalSize', String(attachment.size));
      formData.append('encrypted', 'true');
      formData.append('encryptionIv', iv);
      for (const [name, value] of Object.entries(reencryption.fields ?? {})) formData.append(name, value);

      const upload = await fetch('/api/files', {
        method: 'POST',
        body: formData,
        headers: generationHeaders(),
      });
      if (!upload.ok) {
        const data = (await upload.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Could not encrypt ${attachment.filename}`);
      }
      const data = (await upload.json()) as { fileId: string };
      uploadedIds.push(data.fileId);
      replacements.set(attachment._id, data.fileId);
    }
  } catch (error) {
    await deleteUnlinkedUploads(uploadedIds);
    throw error;
  }

  return {
    contents: contents.map((content) => replaceFileIds(content, replacements, reencryption.keyNoteId)),
    replacements: [...replacements].map(([sourceId, encryptedId]) => ({ sourceId, encryptedId })),
  };
}

/** A Note's plaintext attachments, encrypted under the vault file key for a Secret. */
export async function encryptPromotionAttachments(
  attachments: PromotionAttachment[],
  contents: string[],
  mek: CryptoKey,
  onProgress?: (message: string) => void,
): Promise<{ contents: string[]; replacements: FileReplacement[] }> {
  return reencryptAttachments(
    attachments.filter((attachment) => !attachment.encrypted),
    contents,
    {
      read: async (download) => {
        if (download.headers.get('X-File-Encrypted') === 'true') {
          throw new Error('An attachment changed while the note was being moved');
        }
        return new Uint8Array(await download.arrayBuffer());
      },
      encrypt: (bytes) => encryptFileBytes(mek, bytes),
    },
    onProgress,
  );
}

/**
 * A Secret's attachments, moved under the new Seal's own note key: decrypted
 * with the vault file key, re-encrypted bound to the Seal, and uploaded as that
 * Seal's files.
 */
export async function encryptAttachmentsForSeal(
  attachments: PromotionAttachment[],
  contents: string[],
  keys: { mek: CryptoKey; sealId: string; noteKey: CryptoKey },
  onProgress?: (message: string) => void,
): Promise<{ contents: string[]; replacements: FileReplacement[] }> {
  return reencryptAttachments(
    attachments,
    contents,
    {
      read: async (download) => {
        const bytes = new Uint8Array(await download.arrayBuffer());
        if (download.headers.get('X-File-Encrypted') !== 'true') return bytes;
        const iv = download.headers.get('X-Encryption-IV');
        if (!iv || download.headers.get('X-File-Key-Scope') === 'seal') {
          throw new Error('An attachment changed while the secret was being moved');
        }
        return new Uint8Array(await decryptFileBytes(keys.mek, iv, bytes.buffer));
      },
      encrypt: (bytes) => encryptSealFileBytes(keys.noteKey, keys.sealId, bytes),
      fields: { keyScope: 'seal', keyNoteId: keys.sealId },
      keyNoteId: keys.sealId,
    },
    onProgress,
  );
}
