import type { Page } from '@playwright/test';

export const injectSession = async (page: Page, token: string): Promise<void> => {
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
};
