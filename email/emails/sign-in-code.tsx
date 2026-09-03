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
 * `418207` reads as one long number; `418 207` is what people can copy by eye.
 * The separator is non-breaking so the code can never wrap in half.
 */
function group(code: string) {
  return code.length % 2 === 0 ? `${code.slice(0, code.length / 2)}\u00a0${code.slice(code.length / 2)}` : code;
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

const finePrint: EmailStyle = {
  margin: '0 0 4px 0',
  textAlign: 'center',
  fontFamily: fonts.sans,
  fontSize: '13px',
  lineHeight: '20px',
  msoLineHeightRule: 'exactly',
  color: colors.muted,
};
