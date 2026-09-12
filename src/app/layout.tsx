import '@/styles/globals.css';
import s from './layout.module.scss';
import { geistMono, inter } from '@/config/fonts';
import { Web3ProviderLazy } from '@/providers/Web3ProviderLazy';
import { ReactQueryProvider } from '@/providers/ReactQueryProvider';
import { AuthSessionProvider } from '@/providers/AuthSessionProvider';
import { EncryptionGenerationProvider } from '@/providers/EncryptionGenerationProvider';
import { cn } from '@/utils/cn';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration/ServiceWorkerRegistration';
import { PostHogIdentify } from '@/components/PostHogIdentify/PostHogIdentify';
export { metadata, viewport } from '@/config/meta';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(inter.variable, geistMono.variable)} suppressHydrationWarning>
      <body className={cn('antialiased', s.body)}>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey="sn-theme">
          <AuthSessionProvider>
            <PostHogIdentify />
            <EncryptionGenerationProvider>
              <ReactQueryProvider>
                <Web3ProviderLazy>{children}</Web3ProviderLazy>
              </ReactQueryProvider>
            </EncryptionGenerationProvider>
          </AuthSessionProvider>
          <Toaster />
          <ServiceWorkerRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
