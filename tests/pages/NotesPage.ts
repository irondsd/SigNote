import { type Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { trpcMutationOf, trpcQuery, trpcData } from '../utils/trpc';

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
    const patchPromise = this.page.waitForResponse(trpcMutationOf('notes.'));
    await this.page.getByTestId('save-btn').click();
    await patchPromise;
    const res = await trpcQuery(this.page.request, 'notes.list', {});
    const notes = await trpcData<Array<{ _id: string; content: string }>>(res);
    return notes.find((n) => n._id === noteId)!.content;
  }
}
