import '@/styles/globals.css';
import s from './layout.module.scss';
import { geistMono, geistSans, inter } from '@/config/fonts';
import { Web3Provider } from '@/providers/Web3Provider';
import { AuthSessionProvider } from '@/providers/AuthSessionProvider';
import { cn } from '@/utils/cn';
import { ThemeProvider } from 'next-themes';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { MobileHeader } from '@/components/MobileHeader/MobileHeader';
import { Toaster } from '@/components/ui/sonner';
import { EncryptionProvider } from '@/contexts/EncryptionContext';

export const metadata = {
  title: 'SigNote',
  description: 'Secure note-keeping with Ethereum wallet authentication',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className={cn(geistSans.className, geistMono.variable, 'antialiased', s.body)}>
        <ThemeProvider attribute="class" defaultTheme="system" storageKey="sn-theme">
          <AuthSessionProvider>
            <Web3Provider>
              <EncryptionProvider>
                <div className={s.shell}>
                  <Sidebar />
                  <div className={s.content}>
                    <MobileHeader />
                    <main className={s.main}>{children}</main>
                  </div>
                </div>
              </EncryptionProvider>
            </Web3Provider>
          </AuthSessionProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
