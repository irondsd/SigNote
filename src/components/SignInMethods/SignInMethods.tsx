'use client';

import dynamic from 'next/dynamic';
import { useDesktopApp } from '@/hooks/useDesktopApp';
import { DesktopSignInMethods } from './DesktopSignInMethods';

const WebSignInMethods = dynamic(() => import('./WebSignInMethods').then((module) => module.WebSignInMethods), {
  ssr: false,
});

export function SignInMethods() {
  return useDesktopApp() ? <DesktopSignInMethods /> : <WebSignInMethods />;
}
