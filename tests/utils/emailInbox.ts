import fs from 'fs';

type Captured = {
  to?: string;
  subject?: string;
  template?: string;
  code?: string;
  at?: string;
};

const capturePath = () => {
  const path = process.env.MAIL_CAPTURE_PATH;
  if (!path) throw new Error('MAIL_CAPTURE_PATH is not set — globalSetup should have set it');
  return path;
};

/**
 * Every message the app tried to send, in order. The mailer appends one JSON
 * line per message when `RESEND_API_KEY` is absent, which it always is here.
 */
export function readMailbox(email?: string): Captured[] {
  let raw = '';
  try {
    raw = fs.readFileSync(capturePath(), 'utf8');
  } catch {
    return [];
  }

  const all = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Captured);

  return email ? all.filter((entry) => entry.to?.toLowerCase() === email.toLowerCase()) : all;
}

export const countMail = (email: string): number => readMailbox(email).length;

/**
 * Only the messages carrying a code. Distinct from `countMail` on purpose: an
 * address that just signed in has also received a welcome and a sign-in alert,
 * so counting everything would move the goalposts for the next wait.
 */
export const countCodes = (email: string): number => readMailbox(email).filter((entry) => entry.code).length;

/**
 * Waits for a sign-in code addressed to `email`, returning the newest one.
 *
 * `minCount` is how many *code* messages that address should have by the time
 * we read — pass `countCodes(email) + 1` from before the action to avoid
 * picking up the code from a previous step (which matters when testing resend).
 */
export async function waitForCode(email: string, minCount = 1, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = readMailbox(email).filter((entry) => entry.code);
    if (messages.length >= minCount) {
      return messages[messages.length - 1].code!;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No sign-in code for ${email} within ${timeoutMs}ms (mailbox has ${countMail(email)} messages)`);
}
