jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (cb: () => unknown) => cb() };
});

import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

import {
  captureSessionEpoch,
  findSessionForValidation,
  revokeAllOtherSessions,
  upsertSessionIfMissing,
} from '@/controllers/authSessions';
import { authenticateRequest } from '@/lib/routeAuth';
import type { Db } from '@/db/client';
import { authSessions } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  mockGetToken.mockReset();
});

const userId = 'route-auth-user';
const otherUserId = 'route-auth-other';

const request = () =>
  new NextRequest('http://localhost/api/protected', {
    headers: { 'user-agent': 'TestUA', 'x-forwarded-for': '9.9.9.9' },
  });

const token = (sid: string, sub = userId, sessionEpoch?: number) => ({
  sub,
  sid,
  provider: 'siwe' as const,
  ...(sessionEpoch === undefined ? {} : { sessionEpoch }),
});

const sessionParams = (sid: string, owner = userId) => ({
  sid,
  userId: owner,
  provider: 'siwe' as const,
  ip: '1.2.3.4',
  userAgent: 'UA',
  browser: 'Chrome',
  os: 'macOS',
  deviceType: 'desktop' as const,
});

describe('authenticateRequest — durable session epochs', () => {
  it('captures the current epoch and lazily creates the audit row', async () => {
    const sid = 'fresh-session';
    const epoch = await captureSessionEpoch(userId, sid);
    mockGetToken.mockResolvedValue(token(sid, userId, epoch) as never);

    await expect(authenticateRequest(request())).resolves.toMatchObject({ userId, sid, provider: 'siwe' });
    await expect(findSessionForValidation(sid)).resolves.toMatchObject({ userId, _id: sid });
  });

  it('rejects an old token before lazy creation after revoke-all', async () => {
    const survivorSid = 'survivor';
    await upsertSessionIfMissing({ ...sessionParams(survivorSid), sessionEpoch: 0 });
    await revokeAllOtherSessions(userId, survivorSid);

    const staleSid = 'never-created-before-revoke';
    mockGetToken.mockResolvedValue(token(staleSid, userId, 0) as never);

    await expect(authenticateRequest(request())).rejects.toMatchObject({
      status: 401,
      message: 'Session revoked',
    });
    await expect(findSessionForValidation(staleSid)).resolves.toBeNull();
  });

  it('fails closed for an epoch-less non-survivor after enforcement activates', async () => {
    const survivorSid = 'survivor-for-legacy-check';
    await upsertSessionIfMissing({ ...sessionParams(survivorSid), sessionEpoch: 0 });
    await revokeAllOtherSessions(userId, survivorSid);

    mockGetToken.mockResolvedValue(token('legacy-stale-session') as never);
    await expect(authenticateRequest(request())).rejects.toMatchObject({ status: 401 });
  });

  it('validates the audit row owner against the token subject', async () => {
    const sid = 'owned-by-other-account';
    await upsertSessionIfMissing({ ...sessionParams(sid, otherUserId), sessionEpoch: 0 });
    mockGetToken.mockResolvedValue(token(sid, userId, 0) as never);

    await expect(authenticateRequest(request())).rejects.toMatchObject({ status: 401 });
  });

  it('keeps the explicit survivor usable at its old epoch and for a legacy claim', async () => {
    const survivorSid = 'survivor-live';
    await upsertSessionIfMissing({ ...sessionParams(survivorSid), sessionEpoch: 0 });
    await revokeAllOtherSessions(userId, survivorSid);

    mockGetToken.mockResolvedValue(token(survivorSid, userId, 0) as never);
    await expect(authenticateRequest(request())).resolves.toMatchObject({ userId, sid: survivorSid });

    mockGetToken.mockResolvedValue(token(survivorSid) as never);
    await expect(authenticateRequest(request())).resolves.toMatchObject({ userId, sid: survivorSid });
  });

  it('fails closed if the survivor audit row has disappeared instead of recreating it', async () => {
    const survivorSid = 'survivor-missing-row';
    await upsertSessionIfMissing({ ...sessionParams(survivorSid), sessionEpoch: 0 });
    await revokeAllOtherSessions(userId, survivorSid);
    await db.delete(authSessions);

    mockGetToken.mockResolvedValue(token(survivorSid) as never);
    await expect(authenticateRequest(request())).rejects.toMatchObject({ status: 401 });
    await expect(findSessionForValidation(survivorSid)).resolves.toBeNull();
  });
});
