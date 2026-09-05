import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProfilePage extends BasePage {
  protected defaultUrl = '/profile';

  /** Active (non-archived) count for a stats tile. */
  statCount(tier: 'notes' | 'secrets' | 'seals' | 'auth'): Locator {
    return this.page.getByTestId(`${tier}-count`);
  }

  archivedCount(tier: 'notes' | 'secrets' | 'seals' | 'auth'): Locator {
    return this.page.getByTestId(`${tier}-archived-count`);
  }

  notesCount(): Locator {
    return this.statCount('notes');
  }

  secretsCount(): Locator {
    return this.statCount('secrets');
  }

  sealsCount(): Locator {
    return this.statCount('seals');
  }

  eraseProfileBtn(): Locator {
    return this.page.getByTestId('erase-profile-btn');
  }
}
