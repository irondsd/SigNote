import { expect, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { trpcMutationOf, trpcQuery, trpcData } from '../utils/trpc';

export class NotesPage extends BasePage {
  protected defaultUrl = '/';

  noteCard(title: string): Locator {
    return this.page.getByTestId('note-card').filter({ hasText: title });
  }

  async openInEditMode(title: string): Promise<void> {
    await this.noteCard(title).click();
    // `page.goto()` waits for the document, not for React hydration. A click
    // on the server-rendered Edit button can therefore be lost occasionally
    // under parallel-worker load. Retry the transition until the editing-only
    // Save button is actually mounted.
    const saveButton = this.page.getByTestId('save-btn');
    await expect(async () => {
      if (!(await saveButton.isVisible().catch(() => false))) {
        await this.page.getByTestId('edit-btn').click({ timeout: 1000 });
      }
      await expect(saveButton).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000, intervals: [100, 250, 500] });
    await this.page.getByTestId('tiptap-editor').click();
  }

  async saveAndGetContent(noteId: string): Promise<string> {
    const patchPromise = this.page.waitForResponse(trpcMutationOf('notes.'));
    await this.page.getByTestId('save-btn').click();
    await patchPromise;
    const res = await trpcQuery(this.page.request, 'notes.list', {});
    const notes = await trpcData<Array<{ _id: string; content: string }>>(res);
    return notes.find((n) => n._id === noteId)!.content;
  }
}
