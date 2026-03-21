import fs from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import s from '../docs.module.scss';

type Props = {
  params: Promise<{ slug: string }>;
};

function slugToFilename(docsDir: string, slug: string): string | null {
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
  const match = files.find((f) => {
    const withoutExt = f.replace(/\.md$/, '');
    const dotPos = withoutExt.indexOf('.');
    return dotPos !== -1 && withoutExt.slice(dotPos + 1) === slug;
  });
  return match ? path.join(docsDir, match) : null;
}

export async function generateStaticParams() {
  const docsDir = path.join(process.cwd(), 'src/docs');
  return fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const withoutExt = f.replace(/\.md$/, '');
      const dotPos = withoutExt.indexOf('.');
      return dotPos !== -1 ? { slug: withoutExt.slice(dotPos + 1) } : null;
    })
    .filter((p): p is { slug: string } => p !== null);
}

export default async function DocsSlugPage({ params }: Props) {
  const { slug } = await params;
  const docsDir = path.join(process.cwd(), 'src/docs');
  const filePath = slugToFilename(docsDir, slug);

  if (!filePath) {
    notFound();
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  return (
    <article className={s.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}
