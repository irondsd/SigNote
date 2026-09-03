import { Body, Container, Head, Heading, Hr, Html, Img, Link, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { brand, links } from '../config';
import { cls, responsiveStyles } from '../responsive';
import { colors, type EmailStyle, fonts } from '../theme';

export type EmailLayoutProps = {
  /** The line mail clients show next to the subject. Keep it under ~90 chars. */
  preview: string;
  /** The all-caps kicker above the card. */
  eyebrow?: string;
  heading: string;
  intro: string;
  children?: ReactNode;
};

/**
 * The shell every SigNote email is built from: kicker, white card, brand
 * lockup, centred heading and intro, then whatever the specific email adds,
 * then the two footers.
 *
 * The skeleton is hand-written tables rather than react-email's `Section`,
 * which puts its style on the `<table>` — Outlook renders through Word, which
 * drops padding on a table but honours it on a `<td>`. Same reason there is no
 * flexbox and no grid anywhere in here.
 */
export function EmailLayout({ preview, eyebrow = 'Secure message', heading, intro, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{responsiveStyles}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={shell}>
            <tbody>
              <tr>
                <td style={eyebrowCell}>{eyebrow}</td>
              </tr>
              <tr>
                <td className={cls.card} style={card}>
                  <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align="center" style={lockup}>
                    <tbody>
                      <tr>
                        <td width="26" style={lockupMark}>
                          <Img src={brand.logoUrl} width="26" height="26" alt={brand.name} style={lockupImage} />
                        </td>
                        <td style={lockupWordmark}>{brand.name}</td>
                      </tr>
                    </tbody>
                  </table>

                  <Heading as="h1" className={cls.heading} style={headingStyle}>
                    {heading}
                  </Heading>
                  <Text className={cls.intro} style={introStyle}>
                    {intro}
                  </Text>

                  {children}

                  <Hr style={rule} />
                  <Text style={legal}>
                    End-to-end encrypted ·{' '}
                    <Link href={links.privacy} style={legalLink}>
                      Privacy policy
                    </Link>
                  </Text>
                </td>
              </tr>
              <tr>
                <td style={footer}>
                  Sent by {brand.name} · {brand.postalAddress}
                  <br />
                  <Link href={links.emailPreferences} style={footerLink}>
                    Email preferences
                  </Link>{' '}
                  ·{' '}
                  <Link href={links.unsubscribe} style={footerLink}>
                    Unsubscribe
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * react-email moves this padding off `<body>` and onto the `<td>` it wraps
 * everything in, which is what makes the 16px gutter survive.
 */
const body: EmailStyle = {
  margin: 0,
  padding: '48px 16px',
  backgroundColor: colors.page,
  fontFamily: fonts.sans,
};

/** `width` stays fluid so the card shrinks with the viewport; 600px is the cap. */
const container: EmailStyle = {
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
};

const shell: EmailStyle = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
};

const eyebrowCell: EmailStyle = {
  padding: '0 0 20px 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '11px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.subtle,
};

const card: EmailStyle = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: '16px',
  padding: '40px 44px 32px 44px',
};

const lockup: EmailStyle = {
  margin: '0 auto 28px auto',
  borderCollapse: 'collapse',
};

const lockupMark: EmailStyle = {
  width: '26px',
  padding: 0,
  fontSize: 0,
  lineHeight: 0,
};

const lockupImage: EmailStyle = {
  display: 'block',
  width: '26px',
  height: '26px',
  border: 0,
  outline: 'none',
  textDecoration: 'none',
};

const lockupWordmark: EmailStyle = {
  paddingLeft: '9px',
  fontFamily: fonts.sans,
  fontSize: '17px',
  fontWeight: 'bold',
  letterSpacing: '-0.01em',
  color: colors.heading,
};

const headingStyle: EmailStyle = {
  margin: '0 0 10px 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '24px',
  lineHeight: '30px',
  msoLineHeightRule: 'exactly',
  fontWeight: 'bold',
  letterSpacing: '-0.02em',
  color: colors.heading,
};

const introStyle: EmailStyle = {
  margin: '0 0 28px 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '15px',
  lineHeight: '23px',
  msoLineHeightRule: 'exactly',
  color: colors.body,
};

const rule: EmailStyle = {
  margin: '28px 0 0 0',
  border: 'none',
  borderTop: `1px solid ${colors.rule}`,
};

const legal: EmailStyle = {
  margin: '18px 0 0 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '12px',
  lineHeight: '18px',
  msoLineHeightRule: 'exactly',
  color: colors.subtle,
};

const legalLink: EmailStyle = {
  color: colors.muted,
  textDecoration: 'underline',
};

const footer: EmailStyle = {
  padding: '22px 24px 0 24px',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '12px',
  lineHeight: '19px',
  msoLineHeightRule: 'exactly',
  color: colors.subtle,
};

const footerLink: EmailStyle = {
  color: colors.muted,
  textDecoration: 'underline',
};
