import fs from 'fs';
import path from 'path';
import { DocPage } from '@/components/DocsSidebarNav/DocsSidebarNav';
import { DocsSidebar } from '@/components/DocsSidebar/DocsSidebar';
import { DocsMobileHeader } from '@/components/DocsMobileHeader/DocsMobileHeader';
import s from './layout.module.scss';

function slugToLabel(slug: string): string {
  const parts = slug.split('-');
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(' ');
}

function buildPageList(): DocPage[] {
  const docsDir = path.join(process.cwd(), 'src/docs');
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));

  return files
    .map((file) => {
      const withoutExt = file.replace(/\.md$/, '');
      const dotPos = withoutExt.indexOf('.');
      if (dotPos === -1) return null;
      const index = Number(withoutExt.slice(0, dotPos));
      if (isNaN(index)) return null;
      const slug = withoutExt.slice(dotPos + 1);
      return { index, slug, label: slugToLabel(slug), href: `/docs/${slug}` };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.index - b.index)
    .map(({ slug, label, href }) => ({ slug, label, href }));
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pages = buildPageList();

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
