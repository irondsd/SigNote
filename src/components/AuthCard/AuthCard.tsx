'use client';

import { useMemo } from 'react';

import type { AuthRecord } from '@/contexts/OtpVaultContext';
import type { AuthCodeState } from '@/hooks/useAuthCodes';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import { AuthCardMenu } from './AuthCardMenu';
import s from './AuthCard.module.scss';

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Below this many seconds the ring turns red — the "you will not finish typing" warning. */
const EXPIRING_SECONDS = 5;

/** Two letters is enough to tell GitHub from GitLab at a glance. */
function monogramOf(issuer: string, account: string): string {
  const source = issuer.trim() || account.trim();
  return source.slice(0, 2).toUpperCase() || '··';
}

/** Codes are read aloud and typed in groups; splitting halves is how every
 *  authenticator renders them. An odd digit count puts the extra on the left. */
function splitCode(code: string): [string, string] {
  const half = Math.ceil(code.length / 2);
  return [code.slice(0, half), code.slice(half)];
}

export type AuthCardProps = {
  record: AuthRecord;
  state: AuthCodeState;
  copied: boolean;
  readOnly: boolean;
  readOnlyReason?: string;
  onCopy: () => void;
  onEdit: () => void;
  onExport: () => void;
  onStyleChange: (patch: { color?: NoteColor | null; pattern?: NotePattern | null }) => void;
  onArchivedChange: (archived: boolean) => void;
  onDelete: () => void;
};

export function AuthCard({
  record,
  state,
  copied,
  readOnly,
  readOnlyReason,
  onCopy,
  onEdit,
  onExport,
  onStyleChange,
  onArchivedChange,
  onDelete,
}: AuthCardProps) {
  const secrets = record.secrets;

  /**
   * The arc depletes clockwise: its leading edge sweeps right-and-down from 12
   * o'clock and the gap opens behind it, so the remaining sweep reads as time
   * left. A *negative* dash offset is what runs the pattern in that direction —
   * the usual `C - len` form drains anticlockwise.
   */
  const ringStyle = useMemo(
    () => ({
      strokeDasharray: CIRCUMFERENCE,
      strokeDashoffset: state.fraction * CIRCUMFERENCE - CIRCUMFERENCE,
    }),
    [state.fraction],
  );

  const [codeA, codeB] = splitCode(state.code ?? '');
  const placeholder = '•'.repeat(Math.ceil((secrets?.digits ?? 6) / 2));

  const handleActivate = () => {
    if (!secrets || !state.code) return;
    onCopy();
  };

  return (
    <div
      className={s.card}
      data-testid="auth-card"
      data-color={record.color || undefined}
      data-pattern={record.pattern || undefined}
      data-archived={record.archived || undefined}
      data-unreadable={!secrets || undefined}
      role="button"
      tabIndex={0}
      aria-label={secrets ? `${secrets.issuer || secrets.account} — copy code` : 'Unreadable credential'}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      <div className={s.dial} aria-hidden="true">
        <svg className={s.ring} width="44" height="44" viewBox="0 0 44 44">
          <circle className={s.ringTrack} cx="22" cy="22" r={RADIUS} />
          {secrets && (
            <circle
              className={`${s.ringProgress} ${state.seconds <= EXPIRING_SECONDS ? s.ringExpiring : ''}`}
              cx="22"
              cy="22"
              r={RADIUS}
              style={ringStyle}
            />
          )}
        </svg>
        <span className={s.monogram}>{secrets ? monogramOf(secrets.issuer, secrets.account) : '!'}</span>
      </div>

      <div className={s.body}>
        <div className={s.identity}>
          {secrets ? (
            <>
              <span className={s.issuer}>{secrets.issuer || secrets.account}</span>
              {secrets.issuer && <span className={s.account}>{secrets.account}</span>}
            </>
          ) : (
            <span className={s.issuer}>Unreadable</span>
          )}
          {record.archived && <span className={s.archivedBadge}>Archived</span>}
        </div>

        {secrets ? (
          <div className={s.codeWrap}>
            <div className={s.code} data-testid="auth-code">
              {state.code ? (
                <>
                  <span>{codeA}</span>
                  <span>{codeB}</span>
                </>
              ) : (
                <>
                  <span className={s.codePlaceholder}>{placeholder}</span>
                  <span className={s.codePlaceholder}>{placeholder}</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className={s.unreadable}>This credential cannot be decrypted with the current key.</p>
        )}
      </div>

      {copied && <span className={s.copied}>Copied</span>}

      <AuthCardMenu
        color={record.color}
        pattern={record.pattern}
        archived={record.archived}
        readOnly={readOnly}
        readOnlyReason={readOnlyReason}
        onEdit={onEdit}
        onExport={onExport}
        onStyleChange={onStyleChange}
        onArchivedChange={onArchivedChange}
        onDelete={onDelete}
      />
    </div>
  );
}
