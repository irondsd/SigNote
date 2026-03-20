import { DocPage, DocsSidebarNav } from '@/components/DocsSidebarNav/DocsSidebarNav';
import s from './DocsSidebar.module.scss';

type Props = {
  pages: DocPage[];
};

export function DocsSidebar({ pages }: Props) {
  return (
    <aside className={s.sidebar}>
      <DocsSidebarNav pages={pages} />
    </aside>
  );
}
