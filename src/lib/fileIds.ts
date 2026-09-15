const FILE_ID_RE = /data-file-id="([^"]+)"/g;

export function extractFileIds(html: string): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(FILE_ID_RE)) {
    ids.push(m[1]);
  }
  return ids;
}

// An attachment node is an empty atom `<div …></div>` as the editor serializes it.
const SEAL_KEYED_ATTACHMENT_RE = /<div\b[^>]*\bdata-key-note-id="[^"]+"[^>]*><\/div>/g;

/**
 * Removes attachments under a Seal's own key, for content copied into a
 * different note: they open only under that Seal's key, and the server will not
 * link them anywhere else.
 */
export function stripSealKeyedAttachments(html: string): string {
  return html.replace(SEAL_KEYED_ATTACHMENT_RE, '');
}
