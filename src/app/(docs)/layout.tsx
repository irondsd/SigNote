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

  const pages: DocPage[] = [];

  if (files.includes('about.md')) {
    pages.push({ slug: 'about', label: 'About', href: '/docs/about' });
  }

  files
    .filter((f) => f !== 'about.md')
    .sort()
    .forEach((file) => {
      const slug = file.replace(/\.md$/, '');
      pages.push({ slug, label: slugToLabel(slug), href: `/docs/${slug}` });
    });

  return pages;
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
