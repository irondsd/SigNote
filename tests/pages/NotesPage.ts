import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class NotesPage extends BasePage {
  protected defaultUrl = '/';

  noteCard(title: string): Locator {
    return this.page.getByTestId('note-card').filter({ hasText: title });
  }
}
