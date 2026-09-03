import { EmailButton } from '../components/EmailButton';
import { EmailLayout } from '../components/EmailLayout';
import { links } from '../config';
import { colors, type EmailStyle, fonts } from '../theme';

/** Three things worth doing first, in the order they're worth doing them. */
const highlights = [
  { title: 'Seal a note', description: 'lock any note behind its own key.' },
  { title: 'Tag and colour', description: 'find anything in two keystrokes.' },
  { title: 'Add a passkey', description: 'sign in without a code next time.' },
];

export function WelcomeEmail() {
  return (
    <EmailLayout
      preview="Your SigNote vault is ready"
      heading="Welcome to SigNote"
      intro="Your vault is ready. Everything you write is sealed on your device before it ever reaches us."
    >
      <EmailButton href={links.vault} paddingX={40}>
        Write your first note
      </EmailButton>

      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={list}>
        <tbody>
          {highlights.map((highlight, index) => (
            <tr key={highlight.title}>
              <td width="100%" style={index === highlights.length - 1 ? { ...listItem, ...listItemLast } : listItem}>
                <strong style={{ color: colors.heading }}>{highlight.title}</strong>
                <span style={{ color: colors.muted }}> — {highlight.description}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </EmailLayout>
  );
}

export const welcomeSubject = () => 'Welcome to SigNote';

export default WelcomeEmail;

const list: EmailStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const listItem: EmailStyle = {
  padding: '14px 0',
  borderTop: `1px solid ${colors.rule}`,
  fontFamily: fonts.sans,
  fontSize: '14px',
  lineHeight: '21px',
  msoLineHeightRule: 'exactly',
  color: colors.bodyStrong,
};

const listItemLast: EmailStyle = {
  borderBottom: `1px solid ${colors.rule}`,
};
