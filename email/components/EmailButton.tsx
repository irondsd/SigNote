import { Button } from '@react-email/components';
import type { ReactNode } from 'react';
import { cls } from '../responsive';
import { colors, type EmailStyle, fonts } from '../theme';

export type EmailButtonProps = {
  href: string;
  children: ReactNode;
  /** Horizontal padding in px — wider for a long label, narrower for a short one. */
  paddingX?: number;
  /** Space below the button. */
  spacingBelow?: number;
};

/**
 * The single call to action an email is allowed. `Button` is one of the few
 * react-email components worth using verbatim: it emits the MSO conditional
 * padding that makes a padded `<a>` clickable across its whole box in Outlook.
 * On a narrow screen the stylesheet turns it into a full-width block.
 */
export function EmailButton({ href, children, paddingX = 34, spacingBelow = 24 }: EmailButtonProps) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={wrapper}>
      <tbody>
        <tr>
          <td align="center" style={{ padding: `0 0 ${spacingBelow}px 0` }}>
            <Button href={href} className={cls.cta} style={{ ...button, padding: `14px ${paddingX}px` }}>
              {children}
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const wrapper: EmailStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const button: EmailStyle = {
  display: 'inline-block',
  backgroundColor: colors.brand,
  borderRadius: '10px',
  fontFamily: fonts.sans,
  fontSize: '15px',
  fontWeight: 'bold',
  lineHeight: '20px',
  msoLineHeightRule: 'exactly',
  color: colors.onBrand,
  textAlign: 'center',
  textDecoration: 'none',
};
