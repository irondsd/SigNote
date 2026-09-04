import { test, expect, type Page } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';

import { schema, testDb } from '../fixtures/db';
import { configureGoogleUser } from '../utils/googleAuth';
import { countMail, readMailbox, waitForCode } from '../utils/emailInbox';
import { expectSignedIn, requestCodeInModal, signInWithEmail, signOut, submitCode } from '../utils/emailSignIn';

test.describe.configure({ mode: 'parallel' });

/** Unique per test so the suite can run in parallel against one database. */
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

const userByEmail = async (email: string) => {
  const rows = await testDb()
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
  return rows[0] ?? null;
};

const identitiesOf = (userId: string) =>
  testDb().select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId));

const expireCodesFor = (email: string) =>
  testDb()
    .update(schema.emailSignInCodes)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.emailSignInCodes.email, email.toLowerCase()));

/** Google sign-in, driven through the mock OIDC provider. */
async function signInWithGoogle(
  page: Page,
  profile: { sub: string; name: string; email: string; email_verified?: boolean },
) {
  await configureGoogleUser(page, profile);
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('nextjs-portal').forEach((el) => {
      el.style.pointerEvents = 'none';
    });
  });
  await page.getByTestId('sign-in-button').first().click();
  const googleBtn = page.getByTestId('google-sign-in-btn');
  await googleBtn.waitFor({ state: 'visible' });
  await googleBtn.click();
}

test.describe('sign in with an emailed code', () => {
  test('an unknown address creates an account and signs in', async ({ page }) => {
    const email = uniqueEmail('new');
    await page.goto('/');

    await signInWithEmail(page, email);
    await expectSignedIn(page);

    const user = await userByEmail(email);
    expect(user).not.toBeNull();
    expect(user!.emailVerifiedAt).not.toBeNull();
    // A code proves the mailbox, so nothing owns the address and it stays detachable.
    expect(user!.emailOwnerIdentityId).toBeNull();
    // Signing in this way creates no identity row at all.
    expect(await identitiesOf(user!.id)).toHaveLength(0);
  });

  test('the same address signs back into the same account, not a second one', async ({ page }) => {
    const email = uniqueEmail('returning');
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);
    const first = await userByEmail(email);

    await signOut(page);
    await signInWithEmail(page, email);
    await expectSignedIn(page);

    const rows = await testDb()
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first!.id);
  });

  test('the address is matched case-insensitively', async ({ page }) => {
    const email = uniqueEmail('casing');
    await page.goto('/');
    await signInWithEmail(page, email.toUpperCase());
    await expectSignedIn(page);

    const user = await userByEmail(email);
    expect(user).not.toBeNull();
    expect(user!.email).toBe(email.toLowerCase());
  });

  test('a wrong code is refused and grants no session', async ({ page }) => {
    const email = uniqueEmail('wrong');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);

    const real = await waitForCode(email);
    await submitCode(page, real === '000000' ? '111111' : '000000');

    await expect(page.getByTestId('signin-email-error')).toBeVisible();
    await expect(page.getByTestId('display-name').first()).not.toBeVisible();
    expect(await userByEmail(email)).toBeNull();
  });

  test('a code works once and never again', async ({ page }) => {
    const email = uniqueEmail('replay');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);

    const code = await waitForCode(email);
    await submitCode(page, code);
    await expectSignedIn(page);

    // Same code, fresh session: the row is consumed, so it is worthless now.
    await signOut(page);
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);
    await submitCode(page, code);

    await expect(page.getByTestId('signin-email-error')).toBeVisible();
  });

  test('an expired code is refused', async ({ page }) => {
    const email = uniqueEmail('expired');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);

    const code = await waitForCode(email);
    await expireCodesFor(email);
    await submitCode(page, code);

    await expect(page.getByTestId('signin-email-error')).toBeVisible();
    expect(await userByEmail(email)).toBeNull();
  });

  test('requesting a second code retires the first', async ({ page }) => {
    const email = uniqueEmail('resend');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);

    const first = await waitForCode(email, 1);
    await page.getByTestId('signin-email-resend').click();
    const second = await waitForCode(email, 2);
    expect(second).not.toBe(first);

    await submitCode(page, first);
    await expect(page.getByTestId('signin-email-error')).toBeVisible();

    await page.getByTestId('signin-email-code-input').fill(second);
    await page.getByTestId('signin-email-submit').click();
    await expectSignedIn(page);
  });

  test('five wrong guesses kill the code, even before it expires', async ({ page }) => {
    const email = uniqueEmail('bruteforce');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);

    const code = await waitForCode(email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await submitCode(page, wrong);
      await expect(page.getByTestId('signin-email-error')).toBeVisible();
    }

    await submitCode(page, code);
    await expect(page.getByTestId('signin-email-error')).toBeVisible();
    expect(await userByEmail(email)).toBeNull();
  });

  test('the emailed code never reaches the console log in full-body form', async ({ page }) => {
    const email = uniqueEmail('summary');
    await page.goto('/');
    await page.getByTestId('sign-in-button').first().click();
    await requestCodeInModal(page, email);
    await waitForCode(email);

    // What is captured is the template's inputs, not its rendered output.
    const [message] = readMailbox(email);
    expect(message.template).toBe('sign-in code');
    expect(message.subject).toContain('sign-in code');
    expect(JSON.stringify(message)).not.toContain('<table');
  });
});

test.describe('Google and the emailed code resolve to one account', () => {
  test('a verified Google sign-in adopts an account created by a code', async ({ page }) => {
    const email = uniqueEmail('adopt');
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);
    const created = await userByEmail(email);

    await signOut(page);
    await signInWithGoogle(page, { sub: `g-adopt-${Date.now()}`, name: 'Adopted', email, email_verified: true });
    await expectSignedIn(page);

    // Same account — the identity attached to the existing user rather than
    // creating a second one for the same address.
    const identities = await identitiesOf(created!.id);
    expect(identities).toHaveLength(1);
    expect(identities[0].provider).toBe('google');
  });

  test('an unverified Google sign-in creates an account with no address at all', async ({ page }) => {
    const email = uniqueEmail('unverified');
    await page.goto('/');
    await signInWithGoogle(page, {
      sub: `g-unverified-${Date.now()}`,
      name: 'Unverified',
      email,
      email_verified: false,
    });
    await expectSignedIn(page);

    // Signed in, but the address was never proven, so it was not claimed.
    expect(await userByEmail(email)).toBeNull();

    await page.goto('/profile');
    await expect(page.getByTestId('connect-email')).toBeVisible();
    await expect(page.getByTestId('manage-notifications-btn')).toBeDisabled();
  });

  test('the account heals once Google verifies the address', async ({ page }) => {
    const email = uniqueEmail('heals');
    const sub = `g-heals-${Date.now()}`;

    await page.goto('/');
    await signInWithGoogle(page, { sub, name: 'Healing', email, email_verified: false });
    await expectSignedIn(page);
    expect(await userByEmail(email)).toBeNull();

    await signOut(page);
    await signInWithGoogle(page, { sub, name: 'Healing', email, email_verified: true });
    await expectSignedIn(page);

    // Same sub, now verified: the claim re-runs on every sign-in, so it lands.
    const user = await userByEmail(email);
    expect(user).not.toBeNull();
    expect(user!.emailOwnerIdentityId).not.toBeNull();
  });

  test('an unverified Google sign-in is refused when the address belongs to someone else', async ({ page }) => {
    const email = uniqueEmail('conflict');
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);
    const owner = await userByEmail(email);

    await signOut(page);
    await signInWithGoogle(page, {
      sub: `g-conflict-${Date.now()}`,
      name: 'Impostor',
      email,
      email_verified: false,
    });

    // Refused: no session, and crucially no second account holding the address.
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 15000 });
    expect(await identitiesOf(owner!.id)).toHaveLength(0);
    const rows = await testDb()
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
    expect(rows).toHaveLength(1);
  });

  test('an address proved by Google is read-only until Google is unlinked', async ({ page }) => {
    const email = uniqueEmail('owned');
    await page.goto('/');
    await signInWithGoogle(page, { sub: `g-owned-${Date.now()}`, name: 'Owned', email, email_verified: true });
    await expectSignedIn(page);

    await page.goto('/profile');
    await expect(page.getByTestId('email-method-address')).toContainText(email.toLowerCase());
    await expect(page.getByTestId('email-method-address')).toContainText('via Google');
    await expect(page.getByTestId('unlink-email')).toBeDisabled();
  });
});

test.describe('attaching an address to an existing account', () => {
  test("a code sent to another account's address is refused", async ({ page }) => {
    const taken = uniqueEmail('taken');
    await page.goto('/');
    await signInWithEmail(page, taken);
    await expectSignedIn(page);

    // A second, separate account tries to claim the same address.
    await signOut(page);
    await signInWithGoogle(page, {
      sub: `g-thief-${Date.now()}`,
      name: 'Thief',
      email: uniqueEmail('thief'),
      email_verified: false,
    });
    await expectSignedIn(page);

    await page.goto('/profile');
    await page.getByTestId('connect-email').click();
    await page.getByTestId('link-email-email-input').fill(taken);
    const before = countMail(taken);
    await page.getByTestId('link-email-submit').click();

    await expect(page.getByTestId('link-email-error')).toContainText('different SigNote account');
    // Refused before a code was ever sent — no mail, nothing to guess against.
    expect(countMail(taken)).toBe(before);
  });

  test('an account with no address can attach one and then sign in with it', async ({ page }) => {
    const googleEmail = uniqueEmail('google-side');
    const attached = uniqueEmail('attached');

    await page.goto('/');
    await signInWithGoogle(page, {
      sub: `g-attach-${Date.now()}`,
      name: 'Attacher',
      email: googleEmail,
      email_verified: false,
    });
    await expectSignedIn(page);

    await page.goto('/profile');
    await page.getByTestId('connect-email').click();
    await page.getByTestId('link-email-email-input').fill(attached);
    await page.getByTestId('link-email-submit').click();

    const code = await waitForCode(attached);
    await page.getByTestId('link-email-code-input').fill(code);
    await page.getByTestId('link-email-submit').click();

    // Proved by a code, so nothing owns it and it can be removed again.
    await expect(page.getByTestId('email-method-address')).toContainText(attached.toLowerCase());
    await expect(page.getByTestId('unlink-email')).toBeEnabled();

    const user = await userByEmail(attached);
    expect(user!.emailOwnerIdentityId).toBeNull();

    // And it is now a real way back in.
    await signOut(page);
    await signInWithEmail(page, attached);
    await expectSignedIn(page);

    await page.goto('/profile');
    await expect(page.getByTestId('identity-google')).toBeVisible();
  });

  test('an attached address can be removed again', async ({ page }) => {
    const googleEmail = uniqueEmail('remover');
    const attached = uniqueEmail('removable');

    await page.goto('/');
    await signInWithGoogle(page, {
      sub: `g-remove-${Date.now()}`,
      name: 'Remover',
      email: googleEmail,
      email_verified: false,
    });
    await expectSignedIn(page);

    await page.goto('/profile');
    await page.getByTestId('connect-email').click();
    await page.getByTestId('link-email-email-input').fill(attached);
    await page.getByTestId('link-email-submit').click();
    const code = await waitForCode(attached);
    await page.getByTestId('link-email-code-input').fill(code);
    await page.getByTestId('link-email-submit').click();
    await expect(page.getByTestId('unlink-email')).toBeEnabled();

    await page.getByTestId('unlink-email').click();
    await expect(page.getByTestId('connect-email')).toBeVisible();
    expect(await userByEmail(attached)).toBeNull();
  });

  test('an email-only account cannot remove its only way back in', async ({ page }) => {
    const email = uniqueEmail('only');
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);

    await page.goto('/profile');
    await page.getByTestId('unlink-email').click();

    // Still there: the account has no identity to fall back on.
    await expect(page.getByTestId('email-method-address')).toContainText(email.toLowerCase());
    expect(await userByEmail(email)).not.toBeNull();
  });
});

test.describe('unlinking', () => {
  test('unlinking Google keeps the address it proved, and hands it back to the user', async ({ page }) => {
    const email = uniqueEmail('handback');

    // Google proves it first, so Google owns it. (Had a code proved it first,
    // ownership would stay with the code — it is recorded once and never moves.)
    await page.goto('/');
    await signInWithGoogle(page, { sub: `g-handback-${Date.now()}`, name: 'Handback', email, email_verified: true });
    await expectSignedIn(page);

    await page.goto('/profile');
    // Google vouches for it, so it is read-only...
    await expect(page.getByTestId('unlink-email')).toBeDisabled();

    // ...and unlinking Google is allowed, because the address is a way back in.
    await page.getByTestId('unlink-google').click();
    await expect(page.getByTestId('connect-google')).toBeVisible();

    // The address survived and is now the user's to remove.
    await expect(page.getByTestId('email-method-address')).toContainText(email.toLowerCase());
    await expect(page.getByTestId('unlink-email')).toBeEnabled();

    const user = await userByEmail(email);
    expect(user).not.toBeNull();
    expect(user!.emailOwnerIdentityId).toBeNull();
  });
});

test.describe('notifications', () => {
  test('an account signed in by code can reach its notification settings', async ({ page }) => {
    const email = uniqueEmail('notify');
    await page.goto('/');
    await signInWithEmail(page, email);
    await expectSignedIn(page);

    await page.goto('/profile');
    await expect(page.getByTestId('manage-notifications-btn')).toBeEnabled();

    await page.goto('/notifications');
    await expect(page.getByTestId('pref-product-news')).toBeVisible();
    // The one that cannot be switched off, listed anyway.
    await expect(page.getByTestId('pref-sign-in-codes')).toBeDisabled();
  });
});
