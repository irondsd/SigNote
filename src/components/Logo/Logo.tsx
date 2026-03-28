import { type FC } from 'react';
import s from './Logo.module.scss';
import Link from 'next/link';
import Image from 'next/image';

type LogoProps = {
  className?: string;
};

export const Logo: FC<LogoProps> = ({ className }) => {
  return (
    <Link href="/" className={className}>
      <div className={s.logo}>
        <Image
          className={s.logoIcon}
          src="/images/logo.svg"
          alt="SigNote"
          width={32}
          height={32}
          style={{ width: 'auto' }}
        />
        <span className={s.logoText}>SigNote</span>
      </div>
    </Link>
  );
};
