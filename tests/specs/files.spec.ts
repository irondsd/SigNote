import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';
import { FileAttachmentModel } from '../../src/models/FileAttachment';
import mongoose from 'mongoose';

const pdfPath = path.resolve(__dirname, '../fixtures/files/sample.pdf');
const pngPath = path.resolve(__dirname, '../fixtures/files/sample.png');
const pdfBuffer = fs.readFileSync(pdfPath);
const pngBuffer = fs.readFileSync(pngPath);

test.describe.configure({ mode: 'parallel' });

async function uploadFile(page: import('@playwright/test').Page, buffer: Buffer, name: string, mimeType: string) {
  return page.request.post('/api/files', {
    multipart: { file: { name, mimeType, buffer } },
  });
}

// ─── Upload ─────────────────────────────────────────────────────────────────

test.describe('file upload', () => {
  test('upload a PDF file', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const res = await uploadFile(page, pdfBuffer, 'sample.pdf', 'application/pdf');
    expect(res.status()).toBe(201);

    const json = await res.json();
    expect(json.fileId).toBeTruthy();
    expect(json.filename).toBe('sample.pdf');
    expect(json.mimeType).toBe('application/pdf');
    expect(json.size).toBe(pdfBuffer.length);
  });

  test('upload a PNG image', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const res = await uploadFile(page, pngBuffer, 'sample.png', 'image/png');
    expect(res.status()).toBe(201);

    const json = await res.json();
    expect(json.fileId).toBeTruthy();
    expect(json.filename).toBe('sample.png');
    expect(json.mimeType).toBe('image/png');
    expect(json.size).toBe(pngBuffer.length);
  });

  test('reject file exceeding 5 MB', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await uploadFile(page, bigBuffer, 'big.pdf', 'application/pdf');
    expect(res.status()).toBe(413);
  });

  test('reject disallowed MIME type', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const res = await uploadFile(page, Buffer.from('test'), 'bad.exe', 'application/x-executable');
    expect(res.status()).toBe(415);
  });
});

// ─── Download ───────────────────────────────────────────────────────────────

test.describe('file download', () => {
  test('download uploaded file returns matching content', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const upload = await uploadFile(page, pdfBuffer, 'sample.pdf', 'application/pdf');
    const { fileId } = await upload.json();

    const res = await page.request.get(`/api/files/${fileId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect(res.headers()['content-disposition']).toContain('sample.pdf');

    const body = await res.body();
    expect(body.equals(pdfBuffer)).toBe(true);
  });

  test('download non-existent file returns 404', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await page.request.get(`/api/files/${fakeId}`);
    expect(res.status()).toBe(404);
  });
});

// ─── Delete ─────────────────────────────────────────────────────────────────

test.describe('file delete', () => {
  test('delete uploaded file returns success', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const upload = await uploadFile(page, pdfBuffer, 'sample.pdf', 'application/pdf');
    const { fileId } = await upload.json();

    const res = await page.request.delete(`/api/files/${fileId}`);
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('deleted file returns 404 on subsequent GET', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const upload = await uploadFile(page, pngBuffer, 'sample.png', 'image/png');
    const { fileId } = await upload.json();

    await page.request.delete(`/api/files/${fileId}`);

    const res = await page.request.get(`/api/files/${fileId}`);
    expect(res.status()).toBe(404);
  });

  test('delete non-existent file returns 404', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await page.request.delete(`/api/files/${fakeId}`);
    expect(res.status()).toBe(404);
  });
});

// ─── Auth & Isolation ───────────────────────────────────────────────────────

test.describe('auth and isolation', () => {
  test('unauthenticated upload is rejected', async ({ page }) => {
    await page.goto('/');
    const res = await page.request.post('/api/files', {
      multipart: { file: { name: 'sample.pdf', mimeType: 'application/pdf', buffer: pdfBuffer } },
    });
    expect(res.status()).toBe(401);
  });

  test('user B cannot download user A file', async ({ page, browser }) => {
    const { account: accountA } = makeAccount();
    const notesPageA = new NotesPage(page);
    await notesPageA.signInDirectly(accountA.address);

    const upload = await uploadFile(page, pdfBuffer, 'secret.pdf', 'application/pdf');
    const { fileId } = await upload.json();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const notesPageB = new NotesPage(pageB);
    await notesPageB.signInDirectly();

    const res = await pageB.request.get(`/api/files/${fileId}`);
    expect(res.status()).toBe(404);

    await contextB.close();
  });
});

// ─── Encrypted file uploads ───────────────────────────────────────────────

async function waitForFileUpload(page: import('@playwright/test').Page) {
  const res = await page.waitForResponse(
    (r) => r.url().includes('/api/files') && r.request().method() === 'POST' && r.status() === 201,
  );
  const json = await res.json();
  return json.fileId as string;
}

async function assertFileEncrypted(fileId: string) {
  const doc = await FileAttachmentModel.findById(fileId).lean();
  expect(doc).toBeTruthy();
  expect(doc!.encrypted).toBe(true);
  expect(doc!.encryptionIv).toBeTruthy();
}

async function openNewSecret(page: import('@playwright/test').Page) {
  const secretsPage = new SecretsPage(page);
  await secretsPage.signInDirectly();
  await secretsPage.unlock();
  await page.getByRole('button', { name: 'New Secret' }).click();
  await expect(page.getByTestId('note-title-input')).toBeVisible();
  await page.getByTestId('note-title-input').fill(`Secret ${Date.now()}`);
}

async function openNewSeal(page: import('@playwright/test').Page) {
  const sealsPage = new SealsPage(page);
  await sealsPage.signInDirectly();
  await sealsPage.unlock();
  await page.getByRole('button', { name: 'New Seal' }).click();
  await expect(page.getByTestId('note-title-input')).toBeVisible();
  await page.getByTestId('note-title-input').fill(`Seal ${Date.now()}`);
}

async function openFormatToolbar(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Formatting options' }).click();
  await expect(page.getByRole('button', { name: 'Attach file' })).toBeVisible();
}

async function uploadViaDropZone(page: import('@playwright/test').Page, filePath: string) {
  await openFormatToolbar(page);
  await page.getByRole('button', { name: 'Attach file' }).click();
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeAttached();
  const uploadPromise = waitForFileUpload(page);
  await fileInput.setInputFiles(filePath);
  return uploadPromise;
}

async function uploadViaDrop(page: import('@playwright/test').Page, filePath: string) {
  const editor = page.getByTestId('tiptap-editor');
  await editor.click();

  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const mimeType = fileName.endsWith('.png') ? 'image/png' : 'application/pdf';

  const uploadPromise = waitForFileUpload(page);

  await editor.evaluate(
    (el, { data, name, mime }) => {
      const bytes = new Uint8Array(data);
      const file = new File([bytes], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const rect = el.getBoundingClientRect();
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
      el.querySelector('.tiptap')?.dispatchEvent(event);
    },
    { data: Array.from(buffer), name: fileName, mime: mimeType },
  );

  return uploadPromise;
}

test.describe('encrypted file uploads', () => {
  test.describe.configure({ mode: 'parallel' });

  test('secret: file uploaded via drop zone is encrypted', async ({ page }) => {
    await openNewSecret(page);
    const fileId = await uploadViaDropZone(page, pngPath);
    await assertFileEncrypted(fileId);
  });

  test('secret: file uploaded via direct drop is encrypted', async ({ page }) => {
    await openNewSecret(page);
    const fileId = await uploadViaDrop(page, pngPath);
    await assertFileEncrypted(fileId);
  });

  test('seal: file uploaded via drop zone is encrypted', async ({ page }) => {
    await openNewSeal(page);
    const fileId = await uploadViaDropZone(page, pngPath);
    await assertFileEncrypted(fileId);
  });

  test('seal: file uploaded via direct drop is encrypted', async ({ page }) => {
    await openNewSeal(page);
    const fileId = await uploadViaDrop(page, pngPath);
    await assertFileEncrypted(fileId);
  });

  test('unused drop zone is stripped from saved content', async ({ page }) => {
    const title = `DropZone Strip ${Date.now()}`;
    await openNewSecret(page);
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Some text');
    await openFormatToolbar(page);
    await page.getByRole('button', { name: 'Attach file' }).click();
    await expect(page.getByText('Drop file here or click to browse')).toBeVisible();

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/secrets') && r.request().method() === 'POST',
    );
    await page.getByTestId('save-secret-btn').click();
    await postPromise;

    const secretsPage = new SecretsPage(page);
    await secretsPage.secretCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('Some text', { timeout: 10000 });
    await expect(page.getByText('Drop file here or click to browse')).not.toBeVisible();
  });
});
