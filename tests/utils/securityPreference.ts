import { expect, type Page } from '@playwright/test';
import { trpcMutationOf } from './trpc';

/**
 * Flips one Security switch and waits for the write to land.
 *
 * The switch is optimistic: `data-state` moves before the request is even
 * sent, so asserting on it and then navigating aborts the POST. Under parallel
 * load that is not a rare interleaving — it is the usual one.
 */
export async function setSecurityPreference(page: Page, testId: string, checked: boolean): Promise<void> {
  const saved = page.waitForResponse(trpcMutationOf('security.set'));
  await page.getByTestId(testId).click();
  await saved;
  await expect(page.getByTestId(testId)).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked');
}
