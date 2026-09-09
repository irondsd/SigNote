/**
 * Filler content for `scripts/seedLocalDb.ts`.
 *
 * Everything here runs off one seeded PRNG rather than `Math.random`, so
 * `--seed 7` twice produces byte-identical notes. That is the difference
 * between "the grid looks wrong on the fourth card" being reproducible and
 * being a story.
 */

/** mulberry32 — tiny, fast, and good enough for filler text. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = `lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore
et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo
consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint
occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum vestibulum ante primis
faucibus orci luctus posuere cubilia curae donec pellentesque tincidunt lacus vivamus fringilla suscipit`
  .split(/\s+/)
  .filter(Boolean);

const TITLE_HEADS = [
  'Draft',
  'Notes on',
  'Thoughts about',
  'Plan for',
  'Ideas for',
  'Questions on',
  'Reading list',
  'Follow-up',
  'Rough sketch',
  'Checklist',
  'Scratch',
  'Recipe',
  'Backlog',
  'Retro',
  'Inbox',
];

const TITLE_TAILS = [
  'the migration',
  'weekend reading',
  'the rewrite',
  'tuesday',
  'the offsite',
  'first principles',
  'the api surface',
  'groceries',
  'the sauna trip',
  'winter tyres',
  'the postgres cutover',
  'dark mode',
  'the reading group',
  'next quarter',
  'the move',
];

export const TAG_NAMES = [
  'work',
  'personal',
  'ideas',
  'reading',
  'travel',
  'recipes',
  'finance',
  'someday',
  'urgent',
  'archive-me',
];

export class Gibberish {
  constructor(private readonly rng: () => number) {}

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.rng() < p;
  }

  /** `count` distinct members of `items`, or all of them if there are fewer. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) out.push(...pool.splice(Math.floor(this.rng() * pool.length), 1));
    return out;
  }

  words(count: number): string {
    return Array.from({ length: count }, () => this.pick(WORDS)).join(' ');
  }

  sentence(): string {
    const body = this.words(this.int(5, 14));
    return `${body[0].toUpperCase()}${body.slice(1)}${this.chance(0.15) ? '?' : '.'}`;
  }

  title(): string {
    return `${this.pick(TITLE_HEADS)} ${this.pick(TITLE_TAILS)}`;
  }

  /** A date within the last `days`, so the grid has a plausible spread of ages. */
  recentDate(days: number): Date {
    return new Date(Date.now() - this.int(0, days) * 86_400_000 - this.int(0, 86_399) * 1000);
  }

  /**
   * Tiptap-shaped HTML. Every tier stores the editor's output, so the filler
   * exercises the same block types the app actually round-trips: paragraphs,
   * both list kinds, task items, inline code and links.
   */
  html(): string {
    const blocks: string[] = [];
    for (let i = 0; i < this.int(1, 4); i++) blocks.push(this.block());
    return blocks.join('');
  }

  private block(): string {
    const roll = this.rng();
    if (roll < 0.45) return `<p>${this.inline()}</p>`;
    if (roll < 0.6) return `<h2>${this.words(this.int(2, 4))}</h2><p>${this.inline()}</p>`;
    if (roll < 0.75) return this.list('ul');
    if (roll < 0.85) return this.list('ol');
    return this.taskList();
  }

  private list(tag: 'ul' | 'ol'): string {
    const items = Array.from({ length: this.int(2, 5) }, () => `<li><p>${this.words(this.int(3, 8))}</p></li>`);
    return `<${tag}>${items.join('')}</${tag}>`;
  }

  private taskList(): string {
    const items = Array.from({ length: this.int(2, 5) }, () => {
      const checked = this.chance(0.4);
      return (
        `<li data-checked="${checked}" data-type="taskItem">` +
        `<label><input type="checkbox"${checked ? ' checked="checked"' : ''}><span></span></label>` +
        `<div><p>${this.words(this.int(3, 7))}</p></div></li>`
      );
    });
    return `<ul data-type="taskList">${items.join('')}</ul>`;
  }

  private inline(): string {
    const parts = [this.sentence()];
    if (this.chance(0.3)) parts.push(`<code>${this.words(1)}()</code> ${this.sentence()}`);
    if (this.chance(0.25)) parts.push(`<a href="https://example.com/${this.words(1)}">${this.words(2)}</a>`);
    if (this.chance(0.35)) parts.push(`<strong>${this.words(this.int(1, 3))}</strong> ${this.sentence()}`);
    return parts.join(' ');
  }
}
