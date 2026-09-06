import { Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { cls } from '../responsive';
import { colors, type EmailStyle, fonts } from '../theme';

export type SignInCodeEmailProps = {
  /** The one-time code, digits only. */
  code: string;
  /** Kept in step with whatever TTL the backend stamps on the code. */
  expiresInMinutes?: number;
};

/**
 * `418207` reads as one long number; a gap in the middle is what people can copy
 * by eye. The gap is padding on the first half rather than a space character, so
 * the six digits stay one word: a double-click or tap selects the whole code, and
 * what lands on the clipboard has nothing to strip. Outlook desktop drops padding
 * on inline elements and simply renders the digits evenly spaced, which is fine.
 */
function group(code: string) {
  if (code.length % 2 !== 0) return code;
  const half = code.length / 2;

  return (
    <>
      <span style={firstHalf}>{code.slice(0, half)}</span>
      {code.slice(half)}
    </>
  );
}

export function SignInCodeEmail({ code, expiresInMinutes = 10 }: SignInCodeEmailProps) {
  return (
    <EmailLayout
      preview={`${code} is your SigNote sign-in code`}
      heading="Your sign-in code"
      intro="Enter this code to unlock your notes, secrets, and seals. It works once and only on the device that asked for it."
    >
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={wrapper}>
        <tbody>
          <tr>
            <td align="center" style={{ padding: '0 0 16px 0' }}>
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={codeTable}>
                <tbody>
                  <tr>
                    <td className={cls.code} style={codeCell}>
                      {group(code)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <Text style={finePrint}>
        Expires in {expiresInMinutes} {expiresInMinutes === 1 ? 'minute' : 'minutes'}. If you didn&rsquo;t request it,
        ignore this email — nothing was unlocked.
      </Text>
    </EmailLayout>
  );
}

SignInCodeEmail.PreviewProps = { code: '418207' } satisfies SignInCodeEmailProps;

export const signInCodeSubject = ({ code }: Pick<SignInCodeEmailProps, 'code'>) =>
  `${code} is your SigNote sign-in code`;

export default SignInCodeEmail;

const wrapper: EmailStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const codeTable: EmailStyle = {
  margin: '0 auto',
  borderCollapse: 'collapse',
};

const codeCell: EmailStyle = {
  backgroundColor: colors.panel,
  border: `1px dashed ${colors.panelBorderDashed}`,
  borderRadius: '12px',
  padding: '18px 30px',
  textAlign: 'center',
  fontFamily: fonts.mono,
  fontSize: '30px',
  lineHeight: '34px',
  msoLineHeightRule: 'exactly',
  fontWeight: 'bold',
  letterSpacing: '0.22em',
  color: colors.heading,
};

/** Roughly the advance of the space this replaces, so the grouping reads the same. */
const firstHalf: EmailStyle = {
  paddingRight: '0.75em',
};

const finePrint: EmailStyle = {
  margin: '0 0 4px 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '13px',
  lineHeight: '20px',
  msoLineHeightRule: 'exactly',
  color: colors.muted,
};
