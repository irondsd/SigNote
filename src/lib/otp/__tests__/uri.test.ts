import { buildOtpUri, OtpUriError, parseOtpUri } from '../uri';

const BASE = 'otpauth://totp/ACME%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co';

describe('parseOtpUri — the common case', () => {
  it('reads label, issuer and secret', () => {
    expect(parseOtpUri(BASE)).toEqual({
      type: 'totp',
      issuer: 'ACME Co',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('applies the documented defaults', () => {
    const parsed = parseOtpUri('otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP');
    expect(parsed).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30, issuer: '', account: 'alice' });
  });
});

describe('label handling', () => {
  it('takes a bare label as the account with no issuer', () => {
    expect(parseOtpUri('otpauth://totp/alice%40example.com?secret=JBSWY3DPEHPK3PXP')).toMatchObject({
      issuer: '',
      account: 'alice@example.com',
    });
  });

  it('tolerates a space after the label colon', () => {
    expect(parseOtpUri('otpauth://totp/ACME:%20alice?secret=JBSWY3DPEHPK3PXP')).toMatchObject({
      issuer: 'ACME',
      account: 'alice',
    });
  });

  it('splits only on the first colon', () => {
    expect(parseOtpUri('otpauth://totp/ACME:a%3Ab%3Ac?secret=JBSWY3DPEHPK3PXP')).toMatchObject({
      issuer: 'ACME',
      account: 'a:b:c',
    });
  });

  it('lets the issuer parameter win over the label prefix', () => {
    expect(parseOtpUri('otpauth://totp/Stale:alice?secret=JBSWY3DPEHPK3PXP&issuer=Authoritative')).toMatchObject({
      issuer: 'Authoritative',
      account: 'alice',
    });
  });

  it('falls back to the label when the issuer parameter is blank', () => {
    expect(parseOtpUri('otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=%20')).toMatchObject({
      issuer: 'ACME',
    });
  });
});

describe('parameters', () => {
  it('accepts a lowercase or hyphenated algorithm', () => {
    for (const [written, expected] of [
      ['sha1', 'SHA1'],
      ['SHA256', 'SHA256'],
      ['sha-512', 'SHA512'],
    ] as const) {
      expect(parseOtpUri(`otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=${written}`).algorithm).toBe(expected);
    }
  });

  it('accepts 6, 7 and 8 digits', () => {
    for (const digits of [6, 7, 8]) {
      expect(parseOtpUri(`otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=${digits}`).digits).toBe(digits);
    }
  });

  it('accepts a positive integer period', () => {
    expect(parseOtpUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=60').period).toBe(60);
  });

  it('normalizes a lowercase, spaced secret', () => {
    expect(parseOtpUri('otpauth://totp/a?secret=jbswy3dpehpk3pxp').secret).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('rejection', () => {
  const cases: [string, string, string][] = [
    ['a non-otpauth link', 'https://example.com', 'Not an otpauth:// link'],
    [
      'a Google Authenticator export',
      'otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8',
      'Google Authenticator export links are not supported yet',
    ],
    [
      'an hotp URI',
      'otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=1',
      'Counter-based (HOTP) credentials are not supported yet',
    ],
    [
      'a counter on a totp URI',
      'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&counter=1',
      'Counter-based (HOTP) credentials are not supported yet',
    ],
    [
      'an unknown type',
      'otpauth://steam/a?secret=JBSWY3DPEHPK3PXP',
      'Only time-based (TOTP) credentials are supported',
    ],
    ['a missing secret', 'otpauth://totp/a?issuer=ACME', 'The link has no secret'],
    ['a malformed secret', 'otpauth://totp/a?secret=NOT!BASE32', 'The secret in the link is not valid Base32'],
    [
      'an unsupported algorithm',
      'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      'The link uses an unsupported algorithm',
    ],
    [
      'an unsupported digit count',
      'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=5',
      'The link asks for an unsupported number of digits',
    ],
    ['a zero period', 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=0', 'The link asks for an unsupported period'],
    [
      'a fractional period',
      'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=1.5',
      'The link asks for an unsupported period',
    ],
  ];

  it.each(cases)('rejects %s', (_name, uri, message) => {
    expect(() => parseOtpUri(uri)).toThrow(new OtpUriError(message));
  });

  it('never echoes the input in the message', () => {
    // Security invariant 10: a parse error reaching captureException must not
    // carry the seed, the issuer or the account name with it.
    const uri = 'otpauth://totp/SecretBank:alice%40example.com?secret=JBSWY3DPEHPK3PXP&digits=5';
    try {
      parseOtpUri(uri);
      throw new Error('expected a throw');
    } catch (err) {
      const { message } = err as Error;
      expect(message).not.toContain('SecretBank');
      expect(message).not.toContain('alice');
      expect(message).not.toContain('JBSWY3DP');
    }
  });
});

describe('buildOtpUri', () => {
  const record = {
    issuer: 'ACME Co',
    account: 'alice@example.com',
    secret: 'jbswy3dp ehpk3pxp',
    algorithm: 'SHA256' as const,
    digits: 8,
    period: 60,
  };

  it('round-trips through the parser', () => {
    expect(parseOtpUri(buildOtpUri(record))).toEqual({
      type: 'totp',
      issuer: 'ACME Co',
      account: 'alice@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    });
  });

  it('writes the issuer in both the label and the parameter', () => {
    const uri = buildOtpUri(record);
    expect(uri).toContain('ACME%20Co%3Aalice%40example.com');
    expect(uri).toContain('issuer=ACME+Co');
  });

  it('omits the label prefix when there is no issuer', () => {
    const uri = buildOtpUri({ ...record, issuer: '' });
    expect(uri).toContain('otpauth://totp/alice%40example.com?');
    expect(uri).not.toContain('issuer=');
    expect(parseOtpUri(uri)).toMatchObject({ issuer: '', account: 'alice@example.com' });
  });
});
