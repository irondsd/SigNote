'use client';

import { ArrowBigLeft, PenLine } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyStateLayout } from '@/components/EmptyState/EmptyStateLayout';

export function EmptyStateArchive() {
  const pathname = usePathname();
  const backHref = pathname.replace(/\/archive$/, '') || '/';

  return (
    <EmptyStateLayout
      icon={<PenLine size={48} strokeWidth={1.2} />}
      heading="Your archive is empty"
      sub="You haven't archived any notes yet."
      action={
        <Button asChild className="mt-2">
          <Link href={backHref}>
            <ArrowBigLeft size={16} /> Go back
          </Link>
        </Button>
      }
    />
  );
}
