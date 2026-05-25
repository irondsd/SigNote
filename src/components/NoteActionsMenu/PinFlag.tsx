'use client';

import { useEffect, useRef, useState } from 'react';
import { Pin, X } from 'lucide-react';
import s from './PinFlag.module.scss';

type PinFlagProps = {
  compact?: boolean;
  onUnpin?: () => void;
};

export function PinFlag({ compact = false, onUnpin }: PinFlagProps) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setActive(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active]);

  if (!onUnpin) {
    return (
      <span className={s.flag} data-compact={compact} data-testid="pin-flag">
        <Pin size={compact ? 11 : 12} />
        {!compact && 'Pinned'}
      </span>
    );
  }

  const iconSize = compact ? 11 : 12;

  return (
    <button
      ref={ref}
      type="button"
      className={s.flag}
      data-compact={compact}
      data-interactive="true"
      data-active={active || undefined}
      data-testid="pin-flag"
      aria-label="Unpin note"
      title="Unpin"
      onClick={() => {
        onUnpin();
        setActive(false);
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') {
          setActive(true);
        }
      }}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <span className={s.iconSlot} style={{ width: iconSize, height: iconSize }}>
        <Pin size={iconSize} className={s.iconDefault} />
        <X size={iconSize} className={s.iconActive} />
      </span>
      {!compact && (
        <span className={s.textSlot}>
          <span className={s.textDefault}>Pinned</span>
          <span className={s.textActive}>Unpin</span>
        </span>
      )}
    </button>
  );
}
