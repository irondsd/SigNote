'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import s from './EncryptedPlaceholder.module.scss';

type EncryptedPlaceholderProps = {
  /** Number of placeholder bar rows to render */
  rows?: number;
  /** Base64 ciphertext used to deterministically generate word-strip layout */
  ciphertext?: string;
};

function getByteAt(ct: string, i: number): number {
  return ct.charCodeAt(i % ct.length);
}

type LineData = { weights: number[]; fillFraction: number };

function generateLines(ciphertext: string, lineCount: number): LineData[] {
  return Array.from({ length: lineCount }, (_, l) => {
    const count = 3 + (getByteAt(ciphertext, l * 17) % 5); // 3–7 strips
    const weights = Array.from({ length: count }, (_, s) => 1 + (getByteAt(ciphertext, l * 31 + s * 7 + 5) % 9));
    const isLast = l === lineCount - 1;
    const fillFraction = isLast ? 0.35 + (getByteAt(ciphertext, l * 13 + 2) % 30) / 100 : 1;
    return { weights, fillFraction };
  });
}

function generateRandomLines(lineCount: number): LineData[] {
  return Array.from({ length: lineCount }, (_, l) => {
    const count = 3 + Math.floor(Math.random() * 5); // 3–7 strips
    const weights = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 9));
    const isLast = l === lineCount - 1;
    const fillFraction = isLast ? 0.35 + Math.random() * 0.3 : 1;
    return { weights, fillFraction };
  });
}

function generateRandomSimpleBars(rows: number): string[] {
  return Array.from({ length: rows }, () => `${50 + Math.floor(Math.random() * 45)}%`);
}

export function estimateLines(ciphertext: string): number {
  const estimatedBytes = Math.floor(ciphertext.length * 0.75) - 16;
  const lines = Math.ceil(Math.max(estimatedBytes, 0) / 60);
  return Math.max(6, Math.min(15, lines));
}

const FRAMES = 10;
const INTERVAL_MS = 50; // Total animation duration will be FRAMES * INTERVAL_MS (e.g. 450ms for 6 frames at 75ms each)

export function EncryptedPlaceholder({ rows = 3, ciphertext }: EncryptedPlaceholderProps) {
  const rowWidths = ['85%', '70%', '90%', '60%', '75%'];

  const [shuffleData, setShuffleData] = useState<LineData[] | string[] | null>(() =>
    ciphertext ? generateRandomLines(rows) : generateRandomSimpleBars(rows),
  );

  useEffect(() => {
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame >= FRAMES) {
        clearInterval(id);
        setShuffleData(null);
      } else {
        setShuffleData(ciphertext ? generateRandomLines(rows) : generateRandomSimpleBars(rows));
      }
    }, INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getLineWidth = (i: number, fillFraction: number) => {
    if (fillFraction < 1) return `${fillFraction * 100}%`;
    if (i === 1 || i === 2) return 'calc(100% - 28px)';
    return undefined;
  };

  const renderBars = () => {
    if (shuffleData !== null) {
      if (ciphertext) {
        const lines = shuffleData as LineData[];
        return lines.map((line, i) => (
          <div key={i} className={s.line} style={{ width: getLineWidth(i, line.fillFraction) }}>
            {line.weights.map((w, j) => (
              <div key={j} className={s.strip} style={{ flex: `${w} 0 0` }} />
            ))}
          </div>
        ));
      }
      const widths = shuffleData as string[];
      return widths.map((width, i) => <div key={i} className={s.bar} style={{ width }} />);
    }

    if (ciphertext) {
      const lines = generateLines(ciphertext, rows);
      return lines.map((line, i) => (
        <div key={i} className={s.line} style={{ width: getLineWidth(i, line.fillFraction) }}>
          {line.weights.map((w, j) => (
            <div key={j} className={s.strip} style={{ flex: `${w} 0 0` }} />
          ))}
        </div>
      ));
    }
    return Array.from({ length: rows }).map((_, i) => {
      const baseWidth = rowWidths[i % rowWidths.length];
      const width = i === 1 || i === 2 ? 'calc(100% - 28px)' : baseWidth;
      return <div key={i} className={s.bar} style={{ width }} />;
    });
  };

  return (
    <div data-testid="encrypted-placeholder" className={s.wrapper}>
      <div className={`${s.bars} ${s.animMorph}`}>{renderBars()}</div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={s.lockIcon} aria-label="Content is encrypted">
            <Lock size={14} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Encrypted</TooltipContent>
      </Tooltip>
    </div>
  );
}
