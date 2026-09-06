import fs from 'fs';
import path from 'path';
import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE } from '@/config/meta';

/**
 * The link preview. `twitter.card` is `summary_large_image`, which needs an
 * image to be worth anything — without one the card silently degrades.
 *
 * Drawn here rather than committed as a PNG for the same reason the raster
 * icons are generated: `public/images/logo.svg` stays the only copy of the mark.
 */

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BACKGROUND = '#171717';
const AMBER = '#DC7702';
const AMBER_TEXT = '#F0A63B';

const logo = fs.readFileSync(path.join(process.cwd(), 'public/images/logo.svg'));
const logoSrc = `data:image/svg+xml;base64,${logo.toString('base64')}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: BACKGROUND,
          backgroundImage: `radial-gradient(circle at 88% 12%, rgba(220, 119, 2, 0.22), transparent 55%)`,
          color: '#FAFAFA',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <img src={logoSrc} width={112} height={112} alt="" />
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: '-0.02em' }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: '-0.02em', color: AMBER_TEXT }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 34, color: '#A3A3A3', lineHeight: 1.35 }}>
            Encrypted in your browser. The server only ever stores ciphertext.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: 30, color: '#E5E5E5' }}>
          <div style={{ display: 'flex', width: '64px', height: '6px', borderRadius: '3px', background: AMBER }} />
          <div style={{ display: 'flex' }}>Notes · Secrets · Seals</div>
        </div>
      </div>
    ),
    size,
  );
}
