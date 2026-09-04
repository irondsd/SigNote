import '@/styles/globals.css';
import s from './layout.module.scss';
import { inter } from '@/config/fonts';
import { Web3ProviderLazy } from '@/providers/Web3ProviderLazy';
import { ReactQueryProvider } from '@/providers/ReactQueryProvider';
import { AuthSessionProvider } from '@/providers/AuthSessionProvider';
import { cn } from '@/utils/cn';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration/ServiceWorkerRegistration';
import { ThemeColorMeta } from '@/components/ThemeColorMeta/ThemeColorMeta';
import { PostHogIdentify } from '@/components/PostHogIdentify/PostHogIdentify';
import { THEME_STORAGE_KEY, themeColorInitScript } from '@/config/themeColors';
export { metadata, viewport } from '@/config/meta';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeColorInitScript }} />
      </head>
      <body className={cn(inter.variable, 'antialiased', s.body)}>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
          <AuthSessionProvider>
            <PostHogIdentify />
            <ReactQueryProvider>
              <Web3ProviderLazy>{children}</Web3ProviderLazy>
            </ReactQueryProvider>
          </AuthSessionProvider>
          <Toaster />
          <ServiceWorkerRegistration />
          <ThemeColorMeta />
        </ThemeProvider>
      </body>
    </html>
  );
}
