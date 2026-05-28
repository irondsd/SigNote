'use client';

import { Suspense, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TierToggle, type TierSet } from '@/components/TierToggle/TierToggle';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import s from './page.module.scss';

const ALL_TIERS: TierSet = new Set(['notes', 'secrets', 'seals']);
const VALID = new Set(['notes', 'secrets', 'seals']);

function parseTiers(raw: string | null): TierSet {
  if (!raw) return new Set(ALL_TIERS);
  const parts = raw.split(',').filter((t) => VALID.has(t)) as Array<'notes' | 'secrets' | 'seals'>;
  return parts.length > 0 ? new Set(parts) : new Set(ALL_TIERS);
}

function encodeTiers(tiers: TierSet): string | null {
  if (tiers.size === ALL_TIERS.size) return null;
  return [...tiers].join(',');
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const tiers = useMemo(() => parseTiers(searchParams.get('tiers')), [searchParams]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const updateParams = useCallback(
    (updates: { q?: string; tiers?: TierSet }) => {
      const params = new URLSearchParams(searchParams.toString());
      if ('q' in updates) {
        if (updates.q) params.set('q', updates.q);
        else params.delete('q');
      }
      if ('tiers' in updates) {
        const encoded = encodeTiers(updates.tiers!);
        if (encoded) params.set('tiers', encoded);
        else params.delete('tiers');
      }
      router.replace(`/search${params.toString() ? `?${params.toString()}` : ''}`);
    },
    [router, searchParams],
  );

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>Search</h1>
        <div className={s.inputWrap}>
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => updateParams({ q: e.target.value })}
            placeholder="Search notes, secrets, and seals"
            aria-label="Search"
            className={s.input}
          />
          {q && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => updateParams({ q: '' })}
              className={s.clearBtn}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={16} />
            </Button>
          )}
        </div>
        <TierToggle active={tiers} onChange={(next) => updateParams({ tiers: next })} />
      </div>
      <SearchResults query={q} mode="page" tiers={tiers} onClear={() => updateParams({ q: '' })} />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}
