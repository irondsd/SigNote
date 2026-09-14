import { encryptFileBytes } from '@/lib/crypto';
import { generationHeaders } from '@/lib/encryptionGeneration';

export type PromotionAttachment = {
  _id: string;
  filename: string;
  size: number;
  mimeType: string;
  encrypted: boolean;
};

export type FileReplacement = { sourceId: string; encryptedId: string };

export function replaceFileIds(html: string, replacements: ReadonlyMap<string, string>): string {
  return html.replace(/data-file-id=(['"])([^'"]+)\1/g, (match, quote: string, id: string) => {
    const replacement = replacements.get(id);
    return replacement ? `data-file-id=${quote}${replacement}${quote}` : match;
  });
}

async function deleteUnlinkedUploads(ids: string[]): Promise<void> {
  await Promise.allSettled(
    ids.map((id) => fetch(`/api/files/${id}`, { method: 'DELETE', headers: generationHeaders() })),
  );
}

export async function encryptPromotionAttachments(
  attachments: PromotionAttachment[],
  contents: string[],
  mek: CryptoKey,
  onProgress?: (message: string) => void,
): Promise<{ contents: string[]; replacements: FileReplacement[] }> {
  const plaintext = attachments.filter((attachment) => !attachment.encrypted);
  const uploadedIds: string[] = [];
  const replacements = new Map<string, string>();

  try {
    for (const [index, attachment] of plaintext.entries()) {
      onProgress?.(`Encrypting attachment ${index + 1} of ${plaintext.length}…`);
      const download = await fetch(`/api/files/${attachment._id}`, { headers: generationHeaders() });
      if (!download.ok) throw new Error(`Could not read ${attachment.filename}`);
      if (download.headers.get('X-File-Encrypted') === 'true') {
        throw new Error('An attachment changed while the note was being moved');
      }

      const bytes = new Uint8Array(await download.arrayBuffer());
      const { iv, cipherBytes } = await encryptFileBytes(mek, bytes);
      const formData = new FormData();
      formData.append('file', new Blob([cipherBytes]), attachment.filename);
      formData.append('originalMimeType', attachment.mimeType);
      formData.append('originalSize', String(attachment.size));
      formData.append('encrypted', 'true');
      formData.append('encryptionIv', iv);

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
    contents: contents.map((content) => replaceFileIds(content, replacements)),
    replacements: [...replacements].map(([sourceId, encryptedId]) => ({ sourceId, encryptedId })),
  };
}
