'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraOff } from 'lucide-react';

import { decodeQrFrom } from '@/lib/otp/qr';
import s from './NewAuthModal.module.scss';

const SCAN_INTERVAL_MS = 220;

type QrScannerProps = {
  onResult: (text: string) => void;
};

/**
 * Live camera scanning. The stream never leaves the page — frames are decoded
 * on a canvas here and thrown away.
 *
 * Needs `Permissions-Policy: camera=(self)`; the app previously sent
 * `camera=()`, which disables `getUserMedia` for its own origin.
 */
export function QrScanner({ onResult }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  // The camera effect must not depend on the callback's identity. The page
  // behind this modal re-renders on a 250ms TOTP tick, so a caller passing an
  // inline arrow used to tear the stream down and re-acquire it four times a
  // second — the camera visibly reopening, and never live long enough to
  // decode anything but the easiest code.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stop(stream);
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        timer = setInterval(async () => {
          if (doneRef.current || !videoRef.current) return;
          const el = videoRef.current;
          if (el.readyState < 2) return;
          const text = await decodeQrFrom(el, el.videoWidth, el.videoHeight);
          if (text && !doneRef.current) {
            doneRef.current = true;
            onResultRef.current(text);
          }
        }, SCAN_INTERVAL_MS);
      } catch (err) {
        // Unmounting aborts `play()`; that is not a camera failure.
        if (cancelled) return;
        // The message is ours, never the browser's: a DOMException message can
        // name devices and is not something to surface verbatim.
        setError(
          (err as { name?: string })?.name === 'NotAllowedError'
            ? 'Camera access was declined. Use an image or enter the key by hand.'
            : 'No camera is available. Use an image or enter the key by hand.',
        );
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      stop(stream);
    };
    // Mount-scoped on purpose: acquiring the camera is the expensive, visible
    // part, and nothing about it depends on a prop.
  }, [stop]);

  if (error) {
    return (
      <div className={s.scannerError}>
        <CameraOff size={28} strokeWidth={1.4} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={s.scanner}>
      <video ref={videoRef} className={s.video} playsInline muted />
      <div className={s.reticle} aria-hidden="true" />
      <p className={s.scannerHint}>Point the camera at the QR code</p>
    </div>
  );
}
