import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const mockProviderScript = fs.readFileSync(path.join(__dirname, '../provider', 'mock-provider.js'), 'utf-8');

export async function mockProvider(page: Page) {
  await page.addInitScript(mockProviderScript);
}
