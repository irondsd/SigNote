import { SecurityNoticeEmail, securityNoticeSubject } from '@email/emails/security-notice';
import { SignInCodeEmail, signInCodeSubject } from '@email/emails/sign-in-code';
import { WelcomeEmail, welcomeSubject } from '@email/emails/welcome';
import { renderEmail } from '@email/render';

import { getDeliverableEmail, getNotificationPreferences } from '@/controllers/notifications';
import { sendMail } from '@/lib/mailer';

/**
 * The three emails SigNote sends, each resolving its own recipient and
 * checking its own opt-out.
 *
 * The two courtesy emails are fire-and-forget: nothing a user is waiting on
 * should break because an email didn't go out, so they log and swallow. The
 * sign-in code is the exception — see below.
 */

/** Once, when the account is created. Not gated: there is nothing to opt out of yet. */
export async function sendWelcomeEmail(userId: string): Promise<void> {
  try {
    const to = await getDeliverableEmail(userId);
    if (!to) return; // A wallet-only account has no address. Nothing to do.

    const { html, text } = await renderEmail(<WelcomeEmail />);
    await sendMail({ to, subject: welcomeSubject(), html, text, summary: { template: 'welcome' } });
  } catch (err) {
    console.error('[email] welcome failed:', err);
  }
}

export type SignInAlert = {
  browser: string;
  os: string;
  /** Coarse geo-IP, when the platform gives us one. */
  location?: string;
  when: Date;
};

/**
 * On every new session row — one per actual sign-in, since the session id is
 * minted with the JWT. Suppressed by the "New sign-ins" switch.
 */
export async function sendSignInAlertEmail(userId: string, alert: SignInAlert): Promise<void> {
  try {
    const [to, preferences] = await Promise.all([getDeliverableEmail(userId), getNotificationPreferences(userId)]);
    if (!to || !preferences.signInAlerts) return;

    const { html, text } = await renderEmail(
      <SecurityNoticeEmail
        browser={alert.browser}
        os={alert.os}
        location={alert.location}
        when={formatWhen(alert.when)}
      />,
    );
    await sendMail({
      to,
      subject: securityNoticeSubject({ browser: alert.browser }),
      html,
      text,
      summary: {
        template: 'sign-in alert',
        browser: alert.browser,
        os: alert.os,
        location: alert.location,
        when: formatWhen(alert.when),
      },
    });
  } catch (err) {
    console.error('[email] sign-in alert failed:', err);
  }
}

/**
 * Transactional, so it has no opt-out and no error swallowing — the caller is
 * a sign-in attempt that has to know whether the code actually went out.
 *
 * Nothing calls this yet: the email sign-in flow that mints the code is the
 * next piece of work. It is here so that flow only has to generate a code.
 */
export async function sendSignInCodeEmail(to: string, code: string, expiresInMinutes = 10): Promise<void> {
  const { html, text } = await renderEmail(<SignInCodeEmail code={code} expiresInMinutes={expiresInMinutes} />);
  await sendMail({
    to,
    subject: signInCodeSubject({ code }),
    html,
    text,
    summary: { template: 'sign-in code', code, expires: `${expiresInMinutes} min` },
  });
}

/**
 * The templates take a preformatted timestamp because only the caller can know
 * the reader's timezone — and we don't, so this says UTC rather than quietly
 * rendering server time as if it were the reader's own.
 */
function formatWhen(when: Date): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(when);
  return `${formatted} UTC`;
}
