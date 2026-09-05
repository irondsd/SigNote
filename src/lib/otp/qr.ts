'use client';

/**
 * Local QR decoding. A QR image containing a TOTP seed must never reach a
 * third-party decoding service, so everything here runs in the page.
 *
 * Two backends, in order of preference:
 *  - `BarcodeDetector`, native and fast, present in Chromium and Android;
 *  - jsQR, pure JavaScript, everywhere else.
 *
 * jsQR rather than a WASM decoder on purpose: the production CSP is
 * `script-src 'self' 'unsafe-inline'` with no `'wasm-unsafe-eval'` and no
 * `worker-src`, so zxing-wasm and blob-URL workers fail silently there.
 */

import jsQR from 'jsqr';

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorLike;

let detector: DetectorLike | null | undefined;

function getDetector(): DetectorLike | null {
  if (detector !== undefined) return detector;
  const ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  try {
    detector = ctor ? new ctor({ formats: ['qr_code'] }) : null;
  } catch {
    detector = null;
  }
  return detector;
}

function toImageData(source: CanvasImageSource, width: number, height: number): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Returns the decoded text, or null when the frame holds no QR code. */
export async function decodeQrFrom(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  if (width === 0 || height === 0) return null;

  const native = getDetector();
  if (native) {
    try {
      const found = await native.detect(source);
      if (found.length > 0) return found[0].rawValue;
      // Fall through: a native miss is worth a second opinion from jsQR, which
      // is more forgiving of low contrast screenshots.
    } catch {
      // Detector unusable on this input; jsQR below.
    }
  }

  const imageData = toImageData(source, width, height);
  if (!imageData) return null;
  return jsQR(imageData.data, imageData.width, imageData.height)?.data ?? null;
}

/** Decodes a QR code from a user-supplied image file or pasted screenshot. */
export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image'));
      img.src = url;
    });

    // A phone screenshot can be 1290px wide and a retina desktop grab far more;
    // decoding at full size is slow and buys nothing, but downscaling too far
    // destroys the modules. Cap the long edge instead of forcing a size.
    const MAX_EDGE = 1400;
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    const direct = await decodeQrFrom(image, width, height);
    if (direct) return direct;

    // Second pass at full resolution for a dense code that survived the shrink
    // badly. Only worth it when we actually downscaled.
    if (scale < 1) return await decodeQrFrom(image, image.naturalWidth, image.naturalHeight);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pulls the first image out of a paste event, if there is one. */
export function imageFromClipboard(items: DataTransferItemList | null): File | null {
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
