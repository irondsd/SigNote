import { DocsSidebar } from '@/components/DocsSidebar/DocsSidebar';
import { DocsMobileHeader } from '@/components/DocsMobileHeader/DocsMobileHeader';
import { getDocs } from '@/config/docs';
import s from './layout.module.scss';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pages = getDocs().map(({ slug, navLabel, href }) => ({ slug, label: navLabel, href }));

  return (
    <div className={s.shell}>
      <DocsSidebar pages={pages} />
      <div className={s.content}>
        <DocsMobileHeader pages={pages} />
        <main className={s.main}>{children}</main>
      </div>
    </div>
  );
}
