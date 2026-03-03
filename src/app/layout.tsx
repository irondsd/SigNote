import '@/styles/globals.css';
import s from './layout.module.scss';
import { geistMono, geistSans, inter } from '@/config/fonts';
import { Web3Provider } from '@/providers/Web3Provider';
import { AuthSessionProvider } from '@/providers/AuthSessionProvider';
import { cn } from '@/utils/cn';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={cn(geistSans.className, geistMono.variable, 'antialiased', s.body)}>
        <AuthSessionProvider>
          <Web3Provider>
            <main className={s.main}>{children}</main>
          </Web3Provider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
