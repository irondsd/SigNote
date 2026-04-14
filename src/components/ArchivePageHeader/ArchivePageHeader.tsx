import { Button } from '@/components/ui/button';
import Link from 'next/link';
import s from './ArchivePageHeader.module.scss';
import { InlineSvg } from '@irondsd/inline-svg';

interface ArchivePageHeaderProps {
  title: string;
  backHref: string;
  backLabel: string;
  BackIcon: string;
}

export function ArchivePageHeader({ title, backHref, backLabel, BackIcon }: ArchivePageHeaderProps) {
  return (
    <div className={s.topBar}>
      <h1 className={s.title}>{title}</h1>
      <div className={s.actions}>
        <Link href={backHref}>
          <Button variant="ghost">
            <InlineSvg src={`/icons/${BackIcon}.svg`} className={'w-4.5 h-4.5'} />
            {backLabel}
          </Button>
        </Link>
      </div>
    </div>
  );
}
