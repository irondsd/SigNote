'use client';

import { useEffect, useState, type ReactNode } from 'react';
import s from './EncryptedPlaceholder.module.scss';

type EncryptedPlaceholderProps = {
  /** Number of placeholder bar rows to render */
  rows?: number;
  /** Base64 ciphertext used to deterministically generate word-strip layout */
  ciphertext?: string;
  /** Optional content rendered below the encrypted bars (e.g. a Decrypt button) */
  children?: ReactNode;
};

function getByteAt(ct: string, i: number): number {
  return ct.charCodeAt(i % ct.length);
}

type LineData = { weights: number[]; fillFraction: number };

function generateLines(ciphertext: string, lineCount: number): LineData[] {
  return Array.from({ length: lineCount }, (_, l) => {
    const count = 3 + (getByteAt(ciphertext, l * 17) % 5); // 3–7 strips
    const weights = Array.from({ length: count }, (_, s) => 1 + (getByteAt(ciphertext, l * 31 + s * 7 + 5) % 9));
    const fillSeed = (getByteAt(ciphertext, l * 43 + 11) * 31 + getByteAt(ciphertext, l * 43 + 23)) % 1001;
    const fillFraction = 90 + fillSeed / 100;
    return { weights, fillFraction };
  });
}

function generateRandomLines(lineCount: number): LineData[] {
  return Array.from({ length: lineCount }, () => {
    const count = 3 + Math.floor(Math.random() * 5); // 3–7 strips
    const weights = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 9));
    const fillFraction = 90 + Math.random() * 10;
    return { weights, fillFraction };
  });
}

export function estimateLines(ciphertext: string): number {
  const estimatedBytes = Math.floor(ciphertext.length * 0.75) - 16;
  const lines = Math.ceil(Math.max(estimatedBytes, 0) / 60);
  return Math.max(6, Math.min(15, lines));
}

const FRAMES = 10;
const INTERVAL_MS = 50; // Total animation duration will be FRAMES * INTERVAL_MS (e.g. 450ms for 6 frames at 75ms each)

export function EncryptedPlaceholder({ rows = 3, ciphertext, children }: EncryptedPlaceholderProps) {
  const [shuffleData, setShuffleData] = useState<LineData[] | null>(() => generateRandomLines(rows));

  useEffect(() => {
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame >= FRAMES) {
        clearInterval(id);
        setShuffleData(null);
      } else {
        setShuffleData(generateRandomLines(rows));
      }
    }, INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderBars = () => {
    const lines =
      shuffleData !== null ? shuffleData : ciphertext ? generateLines(ciphertext, rows) : generateRandomLines(rows);
    return lines.map((line, i) => (
      <div key={i} className={s.line} style={{ width: `${line.fillFraction}%` }}>
        {line.weights.map((w, j) => (
          <div key={j} className={s.strip} style={{ flex: `${w} 0 0` }} />
        ))}
      </div>
    ));
  };

  return (
    <div data-testid="encrypted-placeholder" className={s.wrapper}>
      <div className={`${s.bars} ${s.animMorph}`}>{renderBars()}</div>
      {children && <div className={s.children}>{children}</div>}
    </div>
  );
}
