'use client';

import dynamic from 'next/dynamic';
import { isDesktopApp } from '@/lib/desktop';
import { DesktopSignInMethods } from './DesktopSignInMethods';

const WebSignInMethods = dynamic(
  () => import('./WebSignInMethods').then((module) => module.WebSignInMethods),
  { ssr: false },
);

export function SignInMethods() {
  return isDesktopApp() ? <DesktopSignInMethods /> : <WebSignInMethods />;
}
