import fs from 'fs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getDoc, getDocs } from '@/config/docs';
import { OG_IMAGE_PATH, SITE_DESCRIPTION, SITE_NAME } from '@/config/meta';
import s from '../docs.module.scss';

type Props = {
  params: Promise<{ slug: string }>;
};

const markdownComponents: Components = {
  a: ({ href, title, children }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');

    return (
      <a
        href={href}
        title={title}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  },
};

export async function generateStaticParams() {
  return getDocs().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);

  if (!doc) {
    return {};
  }

  const description = doc.description || SITE_DESCRIPTION;
  const title = `${doc.title} | ${SITE_NAME}`;

  // Naming `openGraph` here replaces the root layout's wholesale, and the
  // generated `opengraph-image` goes with it — so the card needs it back.
  const images = [OG_IMAGE_PATH];

  return {
    title: doc.title,
    description,
    alternates: { canonical: doc.href },
    openGraph: {
      type: 'article',
      url: doc.href,
      siteName: SITE_NAME,
      locale: 'en_US',
      title,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images,
    },
  };
}

export default async function DocsSlugPage({ params }: Props) {
  const { slug } = await params;
  const doc = getDoc(slug);

  if (!doc) {
    notFound();
  }

  const content = fs.readFileSync(doc.file, 'utf-8');

  return (
    <article className={s.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
