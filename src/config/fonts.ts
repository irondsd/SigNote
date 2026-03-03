import { Geist, Geist_Mono, Inter } from 'next/font/google';

export const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

export const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
