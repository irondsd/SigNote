import type { Db } from '@/db/client';
import { authIdentities } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { setNotificationPreferences } from '@/controllers/notifications';
import { sendSignInAlertEmail, sendSignInCodeEmail, sendWelcomeEmail } from '@/lib/notificationEmails';
import { sendMail } from '@/lib/mailer';

jest.mock('@/lib/mailer', () => ({ sendMail: jest.fn() }));

const mockSendMail = jest.mocked(sendMail);

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  mockSendMail.mockReset();
});

const userId = '507f1f77bcf86cd799439011';

const giveEmail = (email = 'user@example.com') =>
  db.insert(authIdentities).values({
    userId,
    provider: 'google',
    providerSubject: 'google-sub',
    email,
    emailVerified: true,
    lastLoginAt: new Date(),
  });

const alert = {
  browser: 'Firefox 120',
  os: 'macOS 14',
  location: 'Lisbon, Portugal',
  when: new Date('2026-09-02T14:08:00Z'),
};

describe('sendWelcomeEmail', () => {
  it('sends to the account address', async () => {
    await giveEmail();
    await sendWelcomeEmail(userId);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('user@example.com');
    expect(mail.subject).toBe('Welcome to SigNote');
    expect(mail.html).toContain('Welcome to SigNote');
    expect(mail.text.length).toBeGreaterThan(0);
  });

  it('does nothing for a wallet-only account', async () => {
    await sendWelcomeEmail(userId);

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('swallows a transport failure', async () => {
    await giveEmail();
    mockSendMail.mockRejectedValueOnce(new Error('smtp is on fire'));

    await expect(sendWelcomeEmail(userId)).resolves.toBeUndefined();
  });
});

describe('sendSignInAlertEmail', () => {
  it('sends when the preference is on, naming the browser', async () => {
    await giveEmail();
    await sendSignInAlertEmail(userId, alert);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toBe('New sign-in to SigNote from Firefox 120');
    // The console fallback prints these, not the rendered body.
    expect(mail.summary).toMatchObject({
      template: 'sign-in alert',
      browser: 'Firefox 120',
      os: 'macOS 14',
      location: 'Lisbon, Portugal',
    });
    expect(mail.text).toContain('Lisbon, Portugal');
    // Locale-formatted, so assert the parts ICU won't disagree about.
    expect(mail.text).toMatch(/2026, 14:08 UTC/);
  });

  it('is suppressed by the sign-in alerts opt-out', async () => {
    await giveEmail();
    await setNotificationPreferences(userId, { signInAlerts: false });

    await sendSignInAlertEmail(userId, alert);

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('is not suppressed by the unrelated product-news opt-out', async () => {
    await giveEmail();
    await setNotificationPreferences(userId, { productNews: false });

    await sendSignInAlertEmail(userId, alert);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a wallet-only account', async () => {
    await sendSignInAlertEmail(userId, alert);

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('sendSignInCodeEmail', () => {
  it('puts the code in the subject and the body', async () => {
    await sendSignInCodeEmail('user@example.com', '418207');

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toBe('418207 is your SigNote sign-in code');
    expect(mail.summary).toMatchObject({ template: 'sign-in code', code: '418207' });
    expect(mail.text).toContain('418');
  });

  // Transactional: the sign-in attempt has to know the code never went out.
  it('lets a transport failure through', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('smtp is on fire'));

    await expect(sendSignInCodeEmail('user@example.com', '418207')).rejects.toThrow('smtp is on fire');
  });

  it('ignores notification preferences entirely', async () => {
    await giveEmail();
    await setNotificationPreferences(userId, { productNews: false, signInAlerts: false });

    await sendSignInCodeEmail('user@example.com', '418207');

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
