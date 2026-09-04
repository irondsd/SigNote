import type { Db } from '@/db/client';
import { emailSignInCodes } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { consumeSignInCode, requestSignInCode } from '@/controllers/emailSignInCodes';
import { eq } from 'drizzle-orm';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const email = 'user@example.com';
const issue = async (overrides: { email?: string; ip?: string } = {}) => {
  const result = await requestSignInCode({ email: overrides.email ?? email, ip: overrides.ip ?? '1.2.3.4' });
  if (!result.ok) throw new Error('expected a code');
  return result.code;
};

const rows = () => db.select().from(emailSignInCodes);

describe('requestSignInCode', () => {
  it('issues a six-digit code and stores only a hash of it', async () => {
    const code = await issue();

    expect(code).toMatch(/^\d{6}$/);
    const [row] = await rows();
    expect(row.codeHash).not.toContain(code);
    expect(row.email).toBe(email);
  });

  it('normalises the address so a differently-cased request finds the same code', async () => {
    const code = await issue({ email: '  User@Example.COM ' });

    expect(await consumeSignInCode({ email, code })).toBe('ok');
  });

  it('retires the previous code, so only the newest one works', async () => {
    const first = await issue();
    const second = await issue();

    expect(await consumeSignInCode({ email, code: first })).toBe('invalid');
    expect(await consumeSignInCode({ email, code: second })).toBe('ok');
  });

  it('rate-limits one address', async () => {
    for (let i = 0; i < 5; i += 1) await issue();

    expect(await requestSignInCode({ email, ip: '1.2.3.4' })).toEqual({ ok: false, reason: 'rate-limited' });
  });

  it('rate-limits one IP across different addresses', async () => {
    for (let i = 0; i < 20; i += 1) await issue({ email: `user${i}@example.com`, ip: '9.9.9.9' });

    expect(await requestSignInCode({ email: 'fresh@example.com', ip: '9.9.9.9' })).toEqual({
      ok: false,
      reason: 'rate-limited',
    });
  });

  it('does not rate-limit when the IP is unknown', async () => {
    for (let i = 0; i < 20; i += 1) await issue({ email: `user${i}@example.com`, ip: '' });

    expect((await requestSignInCode({ email: 'fresh@example.com', ip: '' })).ok).toBe(true);
  });
});

describe('consumeSignInCode', () => {
  it('is single-use', async () => {
    const code = await issue();

    expect(await consumeSignInCode({ email, code })).toBe('ok');
    expect(await consumeSignInCode({ email, code })).toBe('invalid');
  });

  it('rejects a code issued for a different address', async () => {
    const code = await issue({ email: 'someone@example.com' });

    expect(await consumeSignInCode({ email: 'other@example.com', code })).toBe('invalid');
  });

  it('reports nothing at all as invalid, not as a distinct state', async () => {
    expect(await consumeSignInCode({ email, code: '000000' })).toBe('invalid');
  });

  it('expires', async () => {
    const code = await issue();
    await db
      .update(emailSignInCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailSignInCodes.email, email));

    expect(await consumeSignInCode({ email, code })).toBe('expired');
  });

  it('dies after five wrong guesses, even if the right code arrives next', async () => {
    const code = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i += 1) {
      expect(await consumeSignInCode({ email, code: wrong })).toBe('invalid');
    }
    expect(await consumeSignInCode({ email, code: wrong })).toBe('too-many-attempts');
    expect(await consumeSignInCode({ email, code })).toBe('too-many-attempts');
  });
});
