'use client';

import cx from 'classnames';
import type { ReactNode } from 'react';
import React, { useRef, useEffect } from 'react';

import s from './Overlay.module.scss';

export type OverlayProps = {
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
};

export const Overlay: React.FC<OverlayProps> = ({ children, className, onClick }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.classList.add(s.mounted);
    }, 400);

    return () => {
      clearTimeout(timer);
    };
  });

  return (
    <div ref={ref} className={cx(s.overlay, className)} onClick={onClick}>
      {children}
    </div>
  );
};
