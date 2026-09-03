import { render } from '@react-email/components';
import type { ReactElement } from 'react';

export type RenderedEmail = {
  html: string;
  /** The multipart/alternative text part. Sending HTML alone hurts deliverability. */
  text: string;
};

/**
 * Renders a template to the two bodies an SMTP/API send needs. Nothing calls
 * this yet — the send path is a separate piece of work.
 */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
