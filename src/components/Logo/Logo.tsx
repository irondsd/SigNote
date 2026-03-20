import { type FC } from 'react';
import s from './Logo.module.scss';
import Link from 'next/link';

type LogoProps = {
  className?: string;
};

export const Logo: FC<LogoProps> = ({ className }) => {
  return (
    <Link href="/" className={className}>
      <div className={s.logo}>
        <span className={s.logoIcon}>✦</span>
        <span className={s.logoText}>SigNote</span>
      </div>
    </Link>
  );
};
