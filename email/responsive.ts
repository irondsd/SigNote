/**
 * The one stylesheet these emails ship.
 *
 * Everything still carries its full inline style; the rules below only narrow
 * things once the viewport does. A client that strips `<style>` — Outlook
 * desktop, mostly — keeps the desktop layout, which is the design, and Outlook
 * has no narrow viewport to worry about anyway.
 */
export const cls = {
  card: 'sn-card',
  heading: 'sn-heading',
  intro: 'sn-intro',
  code: 'sn-code',
  cta: 'sn-cta',
  detailLabel: 'sn-detail-label',
  detailValue: 'sn-detail-value',
} as const;

export const responsiveStyles = `
@media only screen and (max-width: 600px) {
  .${cls.card} { padding: 28px 22px 24px 22px !important; }
  .${cls.heading} { font-size: 21px !important; line-height: 27px !important; }
  .${cls.intro} { font-size: 14px !important; line-height: 22px !important; }
  .${cls.code} {
    font-size: 24px !important;
    line-height: 28px !important;
    letter-spacing: 0.14em !important;
    padding: 16px 18px !important;
  }
  .${cls.cta} { display: block !important; padding-left: 16px !important; padding-right: 16px !important; }
  .${cls.detailLabel} { padding-left: 14px !important; padding-right: 10px !important; }
  .${cls.detailValue} { padding-right: 14px !important; }
}
`;
