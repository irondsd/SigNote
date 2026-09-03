import { EmailButton } from '../components/EmailButton';
import { EmailLayout } from '../components/EmailLayout';
import { links } from '../config';
import { cls } from '../responsive';
import { colors, type EmailStyle, fonts } from '../theme';

export type SecurityNoticeEmailProps = {
  /** Browser and OS as parsed from the user agent, e.g. `Firefox` / `macOS`. */
  browser: string;
  os: string;
  /** Coarse geo-IP location. Left out when we can't place the address. */
  location?: string;
  /**
   * Pre-formatted in the recipient's own timezone by the caller — the template
   * has no idea what that is, and guessing gets it wrong for travellers.
   */
  when: string;
};

export function SecurityNoticeEmail({ browser, os, location, when }: SecurityNoticeEmailProps) {
  return (
    <EmailLayout
      preview={`New sign-in to SigNote from ${browser} on ${os}`}
      heading={`New sign-in from ${browser}`}
      intro="Someone opened your vault a moment ago. If that was you, no action is needed."
    >
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={wrapper}>
        <tbody>
          <tr>
            <td style={{ padding: '0 0 26px 0' }}>
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={panel}>
                <tbody>
                  <tr>
                    <td width="34%" className={cls.detailLabel} style={{ ...panelLabel, ...panelFirstRow }}>
                      Device
                    </td>
                    <td width="66%" className={cls.detailValue} style={{ ...panelValue, ...panelFirstRow }}>
                      {browser} on {os}
                    </td>
                  </tr>
                  <tr>
                    <td width="34%" className={cls.detailLabel} style={panelLabel}>
                      Where
                    </td>
                    <td width="66%" className={cls.detailValue} style={panelValue}>
                      {location ?? 'Location unavailable'}
                    </td>
                  </tr>
                  <tr>
                    <td width="34%" className={cls.detailLabel} style={{ ...panelLabel, ...panelLastRow }}>
                      When
                    </td>
                    <td width="66%" className={cls.detailValue} style={{ ...panelValue, ...panelLastRow }}>
                      {when}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <EmailButton href={links.sessions} spacingBelow={4}>
        Review activity
      </EmailButton>
    </EmailLayout>
  );
}

SecurityNoticeEmail.PreviewProps = {
  browser: 'Firefox',
  os: 'macOS',
  location: 'Lisbon, Portugal',
  when: '2 Sep 2026, 14:08 WEST',
} satisfies SecurityNoticeEmailProps;

export const securityNoticeSubject = ({ browser }: Pick<SecurityNoticeEmailProps, 'browser'>) =>
  `New sign-in to SigNote from ${browser}`;

export default SecurityNoticeEmail;

const wrapper: EmailStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const panel: EmailStyle = {
  width: '100%',
  backgroundColor: colors.panel,
  border: `1px solid ${colors.panelBorder}`,
  borderRadius: '12px',
  borderCollapse: 'separate',
  borderSpacing: 0,
};

const panelLabel: EmailStyle = {
  padding: '6px 18px',
  fontFamily: fonts.sans,
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.subtle,
};

const panelValue: EmailStyle = {
  padding: '6px 18px 6px 0',
  fontFamily: fonts.sans,
  fontSize: '14px',
  lineHeight: '20px',
  msoLineHeightRule: 'exactly',
  color: colors.heading,
};

/** The panel has no padding of its own, so the end rows carry it. */
const panelFirstRow: EmailStyle = { paddingTop: '14px' };
const panelLastRow: EmailStyle = { paddingBottom: '14px' };
