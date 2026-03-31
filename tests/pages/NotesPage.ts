import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class NotesPage extends BasePage {
  protected defaultUrl = '/';

  noteCard(title: string): Locator {
    return this.page.getByTestId('note-card').filter({ hasText: title });
  }

  async openInEditMode(title: string): Promise<void> {
    await this.noteCard(title).click();
    await this.page.getByTestId('edit-btn').click();
    await this.page.getByTestId('tiptap-editor').click();
  }

  async saveAndGetContent(noteId: string): Promise<string> {
    const patchPromise = this.page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await this.page.getByTestId('save-btn').click();
    await patchPromise;
    const res = await this.page.request.get('/api/notes');
    const notes = await res.json();
    return notes.find((n: { _id: string }) => n._id === noteId).content as string;
  }
}
