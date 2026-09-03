# Email

Transactional email templates, built with [react-email](https://react.email).

Nothing here is wired to a sender yet — this directory is the rendering half
only. The send path (provider, queue, suppression list) is separate work.

Templates are rendered at request time, not built: `renderEmail()` turns one
into `{ html, text }` for whatever the sender wants, and Resend's SDK will take
the element directly via its `react` option. There is no export step.
`render()` needs `react-dom/server`, so anything calling it has to be on the
Node runtime — not edge.

```
theme.ts                     colours and font stacks, mirrored from globals.css
config.ts                     absolute origin, brand strings, outbound links
components/EmailLayout.tsx    the shell every email is built from
components/EmailButton.tsx    the one call to action an email is allowed
emails/*.tsx                  the three emails, one file each
render.ts                     template -> { html, text } for the eventual send
```

## Preview

```bash
bun run email
```

Opens the react-email preview app on <http://localhost:3001> with a live reload
per template. Each email exports `PreviewProps`, so the preview shows realistic
values rather than empty strings.

## Adding an email

Add a file under `emails/`, default-export a component that renders
`<EmailLayout>`, and export a `…Subject()` alongside it. The layout owns the
kicker, the brand lockup, the heading, the intro, and both footers; the email
itself owns only what goes between the intro and the divider.

## Responsive

The card is fluid up to 600px, not fixed at it: `width: 100%` with
`max-width: 600px`, so it shrinks with the viewport. Below 600px a single media
query in `responsive.ts` — the one stylesheet these emails ship — tightens the
card padding, drops the heading and code sizes, and makes the CTA full width.
Class hooks come from `cls` in that file.

Every element still carries its complete inline style, so a client that strips
`<style>` (Outlook desktop) renders the desktop design unchanged. Nothing
depends on the stylesheet being applied.

## Constraints worth remembering

- **Tables and inline styles.** Outlook renders through Word: no flexbox, no
  grid, no reliable `<style>` block. The skeleton is hand-written tables rather
  than react-email's `Section`, which puts its style on the `<table>` — Word
  drops padding on a table but honours it on a `<td>`.
- **No web fonts.** Geist won't load in most clients, and a failed `@font-face`
  falls back to something we didn't choose. Arial, deliberately.
- **No SVG.** The logo is a PNG rendered from `public/images/logo.svg` by
  `npm run icons:web`; don't hand-edit it.
- **Absolute URLs only.** Everything resolves through `config.ts` against
  `NEXTAUTH_URL`, so preview and production each point at themselves. Locally
  that means the logo is fetched from `http://localhost:5000` — the preview on
  :3001 shows a broken image unless `bun run dev` is also running.
- **Send both parts.** `renderEmail()` returns HTML and plain text; sending
  HTML alone costs deliverability.
