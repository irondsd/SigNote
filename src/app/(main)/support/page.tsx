import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo/Logo';
import { CopyAddress } from './CopyAddress';
import s from './page.module.scss';

/* ------------------------------------------------------------------ *
 * Everything below is meant to be edited by hand. Nothing on this page
 * reads from the database — the costs and the wallets are constants.
 * ------------------------------------------------------------------ */

/** Contact address shown at the bottom of the page. */
const CONTACT_EMAIL = 'hello@signote.tech';

/** What SigNote costs to run each month. The total is summed, not typed. */
const MONTHLY_COSTS = [
  { label: 'Hosting & app servers', amount: 20 },
  { label: 'Database & egress', amount: 5 },
  { label: 'S3 storage', amount: 5 },
  // { label: 'Encrypted off-site backups', amount: 0 },
  { label: 'Domain & certificates', amount: 2 },
] as const;

/** Chains listed under the EVM wallet as "same address works on". */
const EVM_CHAINS = ['Mainnet', 'Arbitrum', 'Base', 'Optimism', 'Polygon', 'BNB Chain'] as const;

/**
 * The donation wallets. `accent` picks one of the three `--wallet-*` colors
 * defined in `page.module.scss` — they are scoped to this page, not global
 * tokens, because they are chain branding rather than product palette.
 */
const WALLETS = [
  {
    id: 'btc',
    name: 'Bitcoin',
    glyph: '₿',
    accent: 'btc',
    tag: 'BTC · native SegWit',
    address: 'bc1qnyhazuct2kgf8g9pqtwmevz7fm8s0nr4pt8uvw',
  },
  {
    id: 'eth',
    name: 'Ethereum & EVM chains',
    glyph: 'Ξ',
    accent: 'eth',
    tag: 'ETH · USDT · USDC · BNB',
    address: '0xE58a01Bd4a4880e3306a6D4f702EC8eB59b934D2',
    chains: EVM_CHAINS,
  },
  {
    id: 'trx',
    name: 'Tron',
    glyph: 'T',
    accent: 'trx',
    tag: 'TRX · USDT (TRC-20)',
    address: 'TC3MeKxnUFzYq15M6QvPwNVSc5V8Vbx6Dj',
    note: "Cheapest option if you're sending stablecoins — fees are usually under a dollar.",
  },
] as const;

/* ------------------------------------------------------------------ */

const MONTHLY_TOTAL = MONTHLY_COSTS.reduce((sum, { amount }) => sum + amount, 0);

const usd = (amount: number) => `$${amount}`;

export const metadata: Metadata = {
  title: 'Support',
  description:
    'SigNote has no ads, no trackers and no investors. If it is useful to you, a small crypto donation keeps the servers paid for.',
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  return (
    <div className={s.page}>
      <div className={s.bgGrid} aria-hidden="true" />
      <div className={s.bgGlow} aria-hidden="true" />

      <div className={s.container}>
        <header className={s.header}>
          <Logo />
          <nav className={s.nav}>
            {/* Neither page exists yet. Uncomment as they ship. */}
            {/* <Link href="/notes">Notes</Link> */}
            {/* <Link href="/changelog">Changelog</Link> */}
            <Link href="/support" aria-current="page" className={s.navActive}>
              Support
            </Link>
          </nav>
        </header>

        <section className={s.hero}>
          <span className={s.eyebrow}>Support SigNote</span>
          <h1 className={s.title}>SigNote runs on one person&rsquo;s card statement.</h1>
          <p className={s.lead}>
            No ads, no trackers, no investors — and no plans to add any. If SigNote is useful to you, a small crypto
            donation keeps the servers paid for and the roadmap moving.
          </p>
        </section>

        <section className={s.costs}>
          <div className={s.costsProse}>
            <h2 className={s.sectionLabel}>Where the money goes</h2>
            <p>
              Every month there&rsquo;s a domain to renew, a server to rent, S3 buckets holding your attachments, and
              off-site encrypted backups. It is not a lot of money — it&rsquo;s just money that currently comes out of
              my own pocket, every month, whether or not I have a good month.
            </p>
            <p>
              Donations don&rsquo;t buy features or priority. They buy time: fewer hours spent worrying about the bill,
              more hours spent on SigNote.
            </p>
          </div>

          <div className={s.costsCard}>
            <div className={s.costsTotal}>
              <span className={s.costsTotalLabel}>Monthly, roughly</span>
              <span className={s.costsTotalAmount}>{usd(MONTHLY_TOTAL)}</span>
            </div>
            {MONTHLY_COSTS.map(({ label, amount }) => (
              <div key={label} className={s.costRow}>
                <span>{label}</span>
                <span className={s.costAmount}>{usd(amount)}</span>
              </div>
            ))}
            <p className={s.costsFootnote}>Paid personally since launch. Numbers rounded.</p>
          </div>
        </section>

        <section className={s.wallets}>
          <div className={s.walletsIntro}>
            <h2 className={s.sectionTitle}>Send to a wallet</h2>
            <p>
              Any amount, any of these three. Double-check the network before you send — transfers can&rsquo;t be
              reversed.
            </p>
          </div>

          <div className={s.walletList}>
            {WALLETS.map((wallet) => (
              <div key={wallet.id} className={s.walletCard} data-accent={wallet.accent}>
                <div className={s.walletHead}>
                  <span className={s.walletGlyph} aria-hidden="true">
                    {wallet.glyph}
                  </span>
                  <span className={s.walletName}>{wallet.name}</span>
                  <span className={s.walletTag}>{wallet.tag}</span>
                </div>

                <CopyAddress address={wallet.address} label={wallet.name} />

                {'chains' in wallet && (
                  <div className={s.walletChains}>
                    <span>Same address works on</span>
                    {wallet.chains.map((chain) => (
                      <span key={chain} className={s.chainPill}>
                        {chain}
                      </span>
                    ))}
                  </div>
                )}

                {'note' in wallet && <p className={s.walletNote}>{wallet.note}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className={s.alternatives}>
          <div>
            <h3>Can&rsquo;t donate? Also helps</h3>
            <p>Report a bug, suggest a feature, or tell one person who&rsquo;d like SigNote. Genuinely.</p>
          </div>
          <div>
            <h3>No receipts, no tiers</h3>
            <p>
              Donations aren&rsquo;t purchases and don&rsquo;t unlock anything. Every feature stays available to
              everyone.
            </p>
          </div>
          <div>
            <h3>Questions?</h3>
            <p>
              Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and I&rsquo;ll answer myself —
              there&rsquo;s only me.
            </p>
          </div>
        </section>

        <p className={s.signoff}>Thank you for reading this far. — Konstantin Mednikov</p>
      </div>
    </div>
  );
}
