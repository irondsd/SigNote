import fs from 'fs';
import path from 'path';

/**
 * One source of truth for the `src/docs/*.md` set.
 *
 * Four places need to agree about it — the docs sidebar, the `/docs/[slug]`
 * page and its metadata, the sitemap, and `/llms.txt` — and each used to
 * re-parse the filenames on its own. Titles and descriptions are read out of
 * the documents themselves so nothing has to be restated in a second place and
 * then go stale.
 */

export type DocEntry = {
  /** Numeric filename prefix — the authored reading order. */
  index: number;
  slug: string;
  href: string;
  /** Absolute path to the markdown file. */
  file: string;
  /** Short label for the sidebar, derived from the slug. */
  navLabel: string;
  /** The document's own H1, decorative glyph stripped. Used for `<title>`. */
  title: string;
  /** Lead paragraph, markdown stripped, clipped to a meta-description length. */
  description: string;
};

const DOCS_DIR = path.join(process.cwd(), 'src/docs');

/** A search snippet's length — where a description stops growing by choice. */
const TARGET_DESCRIPTION = 160;
/** Below this, a lone opening sentence reads as a stub rather than a summary. */
const MIN_DESCRIPTION = 100;
/** Past this, take the stub instead. */
const MAX_DESCRIPTION = 220;

function slugToNavLabel(slug: string): string {
  const parts = slug.split('-');
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(' ');
}

/**
 * Every doc heading ends in a decorative glyph (`# Privacy 🔏`). It belongs on
 * the page, not in a `<title>` or a search result.
 */
function stripTrailingGlyphs(text: string): string {
  return text.replace(/[\s\u200D\uFE0F\u2190-\u2BFF\p{Extended_Pictographic}]+$/gu, '');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole sentences up to the length budget, falling back to a word boundary. */
function toDescription(paragraph: string): string {
  const text = stripMarkdown(paragraph);

  if (text.length <= TARGET_DESCRIPTION) {
    return text;
  }

  let out = '';
  for (const sentence of text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []) {
    const candidate = out + sentence;

    // Past the target, keep going only while what we have is still too short to
    // stand on its own — one sentence over budget beats a four-word summary.
    if (
      out &&
      candidate.trim().length > TARGET_DESCRIPTION &&
      (out.trim().length >= MIN_DESCRIPTION || candidate.trim().length > MAX_DESCRIPTION)
    ) {
      break;
    }

    out = candidate;
  }
  out = out.trim();

  if (out && out.length <= MAX_DESCRIPTION) {
    return out;
  }

  const clipped = text.slice(0, TARGET_DESCRIPTION);
  return `${clipped.slice(0, clipped.lastIndexOf(' '))}…`;
}

function readDoc(fileName: string): DocEntry | null {
  const withoutExt = fileName.replace(/\.md$/, '');
  const dotPos = withoutExt.indexOf('.');
  if (dotPos === -1) return null;

  const index = Number(withoutExt.slice(0, dotPos));
  if (Number.isNaN(index)) return null;

  const slug = withoutExt.slice(dotPos + 1);
  const file = path.join(DOCS_DIR, fileName);
  const lines = fs.readFileSync(file, 'utf-8').split('\n');

  const headingIndex = lines.findIndex((line) => line.startsWith('# '));
  const title = headingIndex === -1 ? slugToNavLabel(slug) : stripTrailingGlyphs(lines[headingIndex].slice(2).trim());

  // The docs are written lead-first, so the paragraph under the H1 is already
  // the summary — no second copy to maintain.
  const paragraph: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (paragraph.length) break;
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.startsWith('|')) break;

    paragraph.push(trimmed);
  }

  return {
    index,
    slug,
    href: `/docs/${slug}`,
    file,
    navLabel: slugToNavLabel(slug),
    title,
    description: toDescription(paragraph.join(' ')),
  };
}

let cached: DocEntry[] | null = null;

export function getDocs(): DocEntry[] {
  // Re-read in development so editing a doc updates its nav label and metadata
  // without a restart.
  if (cached && process.env.NODE_ENV === 'production') {
    return cached;
  }

  cached = fs
    .readdirSync(DOCS_DIR)
    .filter((fileName) => fileName.endsWith('.md'))
    .map(readDoc)
    .filter((doc): doc is DocEntry => doc !== null)
    .sort((a, b) => a.index - b.index);

  return cached;
}

export function getDoc(slug: string): DocEntry | null {
  return getDocs().find((doc) => doc.slug === slug) ?? null;
}
