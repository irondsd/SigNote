import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProfilePage extends BasePage {
  protected defaultUrl = '/profile';

  notesCount(): Locator {
    return this.page.getByTestId('notes-count');
  }

  secretsCount(): Locator {
    return this.page.getByTestId('secrets-count');
  }

  sealsCount(): Locator {
    return this.page.getByTestId('seals-count');
  }

  eraseProfileBtn(): Locator {
    return this.page.getByTestId('erase-profile-btn');
  }
}
