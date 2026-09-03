import { isMailConfigured, sendMail } from '@/lib/mailer';

const mail = {
  to: 'user@example.com',
  subject: 'Your sign-in code',
  html: '<p>418 207</p>',
  text: 'A long rendered body, footer and all.',
  summary: { template: 'sign-in code', code: '418207', expires: '10 min', location: undefined },
};

describe('mailer without RESEND_API_KEY', () => {
  const original = process.env.RESEND_API_KEY;
  let info: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    info.mockRestore();
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
  });

  it('reports itself as unconfigured', () => {
    expect(isMailConfigured()).toBe(false);
  });

  it('resolves instead of throwing, so a sign-in is never blocked by mail', async () => {
    await expect(sendMail(mail)).resolves.toBeUndefined();
  });

  it('prints the recipient, the subject and the template fields', async () => {
    await sendMail(mail);

    const printed = info.mock.calls[0][0] as string;
    expect(printed).toContain('user@example.com');
    expect(printed).toContain('Your sign-in code');
    // The code matters most: locally this is the only place to read it.
    expect(printed).toContain('418207');
    expect(printed).toContain('10 min');
  });

  it('prints the summary instead of the rendered body', async () => {
    await sendMail(mail);

    expect(info.mock.calls[0][0]).not.toContain('A long rendered body');
  });

  it('drops fields with no value rather than printing an empty row', async () => {
    await sendMail(mail);

    expect(info.mock.calls[0][0]).not.toContain('location');
  });
});
