import { Resend } from 'resend';

export type OutgoingMail = {
  to: string;
  subject: string;
  html: string;
  /** The text/plain alternative. Sending HTML alone costs deliverability. */
  text: string;
  /**
   * What to print in place of the body when there is no API key: the values
   * that went into the template, not the template's output. A rendered email
   * is mostly footer, and 500 lines of it per send makes the dev console
   * useless. Undefined values are dropped.
   */
  summary?: Record<string, string | number | undefined>;
};

/**
 * Must be a domain verified in Resend. `onboarding@resend.dev` is Resend's
 * sandbox sender and only delivers to the account owner's own address, which
 * is enough for a smoke test and nothing else.
 */
const FROM = process.env.EMAIL_FROM ?? 'SigNote <onboarding@resend.dev>';

let client: Resend | null = null;

const getClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  client ??= new Resend(apiKey);
  return client;
};

export const isMailConfigured = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Sends one message, or — with no `RESEND_API_KEY` — prints a one-line-per-
 * field summary of it.
 *
 * The key is deliberately optional: local development never has one, and an
 * app that refuses to sign you in because it couldn't send a courtesy email is
 * worse than one that logs it. Whatever the caller puts in `summary` is what
 * shows up, which is how a one-time code stays readable locally without
 * dumping the whole rendered body into the console.
 *
 * Throws when a configured send fails. Callers that are fire-and-forget catch
 * it themselves; a caller whose user is waiting on the mail should let it
 * surface.
 */
export async function sendMail({ to, subject, html, text, summary }: OutgoingMail): Promise<void> {
  const resend = getClient();

  if (!resend) {
    console.info(formatUnsent({ to, subject, ...summary }));
    return;
  }

  const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
  if (error) {
    throw new Error(`Resend rejected the message: ${error.message}`);
  }
}

/** Aligned `key: value` lines, so a run of these stays scannable. */
function formatUnsent(fields: Record<string, string | number | undefined>): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined && value !== '');
  const width = Math.max(...entries.map(([key]) => key.length));

  return [
    '── email (not sent — RESEND_API_KEY is unset) ──',
    ...entries.map(([key, value]) => `   ${key.padEnd(width)}  ${value}`),
    '──',
  ].join('\n');
}
