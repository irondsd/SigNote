import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { NotesPage } from '../pages/NotesPage';
import mongoose from 'mongoose';

const pdfBuffer = fs.readFileSync(path.resolve(__dirname, '../fixtures/files/sample.pdf'));
const pngBuffer = fs.readFileSync(path.resolve(__dirname, '../fixtures/files/sample.png'));

test.describe.configure({ mode: 'parallel' });

async function uploadFile(
  page: import('@playwright/test').Page,
  buffer: Buffer,
  name: string,
  mimeType: string,
) {
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
