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
import type { Viewport } from 'next';

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    {
      media: '(prefers-color-scheme: light)',
      color: '#FDF8F4',
    },
    {
      media: '(prefers-color-scheme: dark)',
      color: '#1E150D',
    },
  ],
};

export const metadata = {
  title: 'SigNote',
  description: 'Secure note-keeping with Ethereum wallet authentication',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'SigNote',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(inter.variable, 'antialiased', s.body)}>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey="sn-theme">
          <AuthSessionProvider>
            <ReactQueryProvider>
              <Web3ProviderLazy>{children}</Web3ProviderLazy>
            </ReactQueryProvider>
          </AuthSessionProvider>
          <Toaster />
          <ServiceWorkerRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
