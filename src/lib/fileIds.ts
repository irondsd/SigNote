const FILE_ID_RE = /data-file-id="([^"]+)"/g;

export function extractFileIds(html: string): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(FILE_ID_RE)) {
    ids.push(m[1]);
  }
  return ids;
}
