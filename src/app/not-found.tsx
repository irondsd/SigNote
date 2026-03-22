import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MobileHeader } from '@/components/MobileHeader/MobileHeader';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh w-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-0 max-md:pt-15">
        <MobileHeader />
        <main className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col flex-1 items-center justify-center gap-3 px-5 py-20 text-center">
            <div className="text-muted-foreground opacity-50 mb-1">
              <FileQuestion size={48} strokeWidth={1.2} />
            </div>
            <h3 className="text-[20px] font-semibold text-foreground m-0">Page not found</h3>
            <p className="text-sm text-muted-foreground m-0">The page you&apos;re looking for doesn&apos;t exist.</p>
            <Button className="mt-2" asChild>
              <Link href="/">Go home</Link>
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
