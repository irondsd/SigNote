'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { VaultExportCategory } from '@/lib/vaultBackup/exportTypes';
import {
  importDecisionKey,
  type ImportConflict,
  type ImportDecision,
  type ImportRecordSummary,
} from '@/lib/vaultBackup/importMerge';
import s from './page.module.scss';

const LABELS: Record<VaultExportCategory, string> = {
  notes: 'Notes',
  secrets: 'Secrets',
  seals: 'Seals',
  authenticators: 'Authenticator',
};
const PAGE = 50;

export const BOUND_TO_ID =
  'This encrypted item is cryptographically bound to its original ID. Unlocking and re-encrypting it would be required to create a second copy.';
const ATTACHMENT_IN_USE =
  'An attachment of this item already exists here as a different file, and the item refers to its attachments by ID.';

function when(value: string) {
  return new Date(value).toLocaleString();
}

function flags(summary: ImportRecordSummary) {
  return [summary.deletedAt ? 'in trash' : null, summary.archived ? 'archived' : null].filter(Boolean).join(' · ');
}

function name(conflict: ImportConflict, summary: ImportRecordSummary) {
  // Authenticator issuer and account are encrypted: identify by id suffix.
  if (conflict.category === 'authenticators') return `Credential …${conflict.id.slice(-6)}`;
  return summary.title || 'Untitled';
}

const ROUTES: Partial<Record<VaultExportCategory, string>> = { notes: '', secrets: '/secrets', seals: '/seals' };

/** Where the existing item opens (`?id=` reopens it in its grid). Encrypted
 * items unlock in the ordinary vault, in that tab — this page never holds the
 * key. Trashed items and Authenticator records have no item view. */
function existingHref(conflict: ImportConflict): string | null {
  const base = ROUTES[conflict.category];
  if (base === undefined || conflict.existing.deletedAt) return null;
  return `${conflict.existing.archived ? `${base}/archive` : base || '/'}?id=${encodeURIComponent(conflict.id)}`;
}

function allowed(conflict: ImportConflict, decision: ImportDecision) {
  if (decision === 'replace') return conflict.replaceBlocked === null;
  if (decision === 'copy') return conflict.copyBlocked === null;
  return true;
}

function reason(conflict: ImportConflict, decision: ImportDecision): string | undefined {
  if (decision === 'replace' && conflict.replaceBlocked) return ATTACHMENT_IN_USE;
  if (decision === 'copy' && conflict.copyBlocked === 'bound-to-id') return BOUND_TO_ID;
  if (decision === 'copy' && conflict.copyBlocked) return ATTACHMENT_IN_USE;
  return undefined;
}

const OPTIONS: Array<{ value: ImportDecision; label: string }> = [
  { value: 'keep', label: 'Keep existing' },
  { value: 'replace', label: 'Replace from backup' },
  { value: 'copy', label: 'Keep both' },
];

export function ImportConflicts({
  conflicts,
  decisions,
  onChange,
}: {
  conflicts: ImportConflict[];
  decisions: Map<string, ImportDecision>;
  onChange: (next: Map<string, ImportDecision>) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<VaultExportCategory, ImportConflict[]>();
    for (const conflict of conflicts) {
      const list = map.get(conflict.category) ?? [];
      list.push(conflict);
      map.set(conflict.category, list);
    }
    return [...map];
  }, [conflicts]);
  const [shown, setShown] = useState<Record<string, number>>({});

  const set = (entries: Array<[string, ImportDecision]>) => {
    const next = new Map(decisions);
    for (const [key, value] of entries) next.set(key, value);
    onChange(next);
  };

  return (
    <div className={s.conflictGroups}>
      {groups.map(([category, list]) => {
        const limit = shown[category] ?? PAGE;
        return (
          <section key={category} className={s.conflictGroup} aria-label={`${LABELS[category]} conflicts`}>
            <div className={s.conflictGroupHead}>
              <strong>
                {LABELS[category]} · {list.length}
              </strong>
              <div className={s.applyAll} role="group" aria-label={`Apply to all ${LABELS[category]}`}>
                <span>Apply to all:</span>
                {OPTIONS.map((option) => {
                  // "All" applies where the choice is possible; the rest keep theirs.
                  const eligible = list.filter((conflict) => allowed(conflict, option.value));
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!eligible.length}
                      title={eligible.length ? undefined : reason(list[0], option.value)}
                      onClick={() =>
                        set(eligible.map((conflict) => [importDecisionKey(category, conflict.id), option.value]))
                      }
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            {(category === 'seals' || category === 'authenticators') && (
              <p className={s.help}>Keep both is unavailable. {BOUND_TO_ID}</p>
            )}
            <ul className={s.conflictList}>
              {list.slice(0, limit).map((conflict) => {
                const key = importDecisionKey(category, conflict.id);
                const current = decisions.get(key) ?? 'keep';
                return (
                  <li key={key} className={s.conflictRow} data-testid="import-conflict">
                    <div className={s.conflictSides}>
                      <div>
                        <small>In backup</small>
                        <strong>{name(conflict, conflict.archive)}</strong>
                        <span>
                          Saved {when(conflict.archive.updatedAt)}
                          {flags(conflict.archive) && ` · ${flags(conflict.archive)}`}
                        </span>
                      </div>
                      <div>
                        <small>In this account</small>
                        <strong>{name(conflict, conflict.existing)}</strong>
                        <span>
                          Saved {when(conflict.existing.updatedAt)}
                          {flags(conflict.existing) && ` · ${flags(conflict.existing)}`}
                        </span>
                        {existingHref(conflict) && (
                          <a href={existingHref(conflict)!} target="_blank" rel="noopener noreferrer">
                            Open in a new tab
                          </a>
                        )}
                      </div>
                    </div>
                    <div
                      className={s.decision}
                      role="radiogroup"
                      aria-label={`Resolve ${name(conflict, conflict.archive)}`}
                    >
                      {OPTIONS.map((option) => {
                        const ok = allowed(conflict, option.value);
                        return (
                          <label
                            key={option.value}
                            className={ok ? undefined : s.disabledChoice}
                            title={reason(conflict, option.value)}
                          >
                            <input
                              type="radio"
                              name={key}
                              value={option.value}
                              checked={current === option.value}
                              disabled={!ok}
                              onChange={() => set([[key, option.value]])}
                            />
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
            {list.length > limit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShown((value) => ({ ...value, [category]: limit + PAGE }))}
              >
                Show {Math.min(PAGE, list.length - limit)} more
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
