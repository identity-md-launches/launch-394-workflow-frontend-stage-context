# Piggy Vault — design system as implemented

This documents the design actually shipped in `web/src/` for the one-page Piggy Vault
site (`lab-donation-vault`). It is extracted from source and confirmed in the browser
(see `docs/validation/README.md`). The assignment's write scope is `web/**`, `dist/**`
and `docs/**`, so this file lives at `docs/DESIGN.md` rather than the repository root.

## Overview

Audience: Sepolia testnet users holding PIGY who want to deposit into, redeem from or
donate to an ERC-4626 vault, and anyone checking the vault's live state. The visual
character is a calm, warm-neutral "paper" page with white cards, one rose accent for
interactive elements, generous whitespace and tabular numbers. Density is moderate:
one column of stacked cards, stats in an auto-fitting grid, three action forms side by
side when the width allows.

System-wide rules: cards group content, space (not lines) separates groups, the accent
appears only on interactive elements, every changing number uses tabular figures, and
every transaction control is disabled with a visible reason until its prerequisites hold.
Page-specific arrangement (header with wallet control, Vault → Position → Actions →
Chart → Getting PIGY → Notes) is this page's reading order, not a rule for other pages.

Light theme only; no dark theme is implemented (`color-scheme: light`).

## Colors

All tokens are CSS custom properties in `web/src/styles.css` (`:root`). Primitives are
named by hue; components reference only semantic tokens.

| Semantic token | Value (primitive) | Job |
| --- | --- | --- |
| `--color-bg` | `#faf8f4` (`--sand-50`) | page background |
| `--color-surface` | `#ffffff` | cards, inputs, header, footer, tooltip |
| `--color-surface-muted` | `#f3efe8` (`--sand-100`) | empty state, info status, disabled buttons, hover on neutral buttons |
| `--color-border` | `#e6e0d6` (`--sand-200`) | card and table hairlines, chart gridlines |
| `--color-border-strong` | `#cfc6b8` (`--sand-300`) | skip link border, chart axis line |
| `--color-border-control` | `#8a8073` (`--sand-500`) | input and secondary-button borders (3.88:1 on white) |
| `--color-text` | `#1f1b17` (`--ink-900`) | primary text (17.1:1 on white) |
| `--color-text-secondary` | `#5c554c` (`--ink-600`) | labels, descriptions, axis text (7.35:1 on white) |
| `--color-text-muted` | `#857c71` (`--ink-400`) | chart crosshair only |
| `--color-accent` / `--color-accent-hover` | `#a8325c` / `#8b2749` (`--rose-600/700`) | primary button fill, links, table summary (6.41:1 white-on-accent) |
| `--color-accent-soft` | `#fbe7ee` (`--rose-100`) | reserved tint; currently unused by components |
| `--color-on-accent` | `#ffffff` | text on accent |
| `--color-focus` | `#1a56c4` (`--blue-600`) | `:focus-visible` ring only (6.6:1 on white) |
| `--color-series` / `--color-series-soft` | `#0f7b8a` / `#dff3f5` (`--teal-700/100`) | chart line and markers (4.98:1 on white) |
| `--color-ok-text` / `--color-ok-bg` | `#1b6e3a` / `#e4f4e9` | connected-network chip, confirmed status (5.52:1) |
| `--color-error-text` / `--color-error-bg` | `#a3271f` / `#fbe9e7` | inline errors, failed status (6.25:1) |
| `--color-warning-text` / `--color-warning-bg` | `#7a5300` / `#fff1cf` | wrong-network chip (6.11:1) |

Ratios above were computed from the declared pairs (`test/scratch/contrast.mjs` during
validation); rendered pairs match because no alpha or gradients are used except the
card shadows. One hue has one meaning: rose = interactive, blue = keyboard focus,
teal = data, green/red/amber = status. Do not use the accent on static text.

## Typography

Fonts are system stacks; no font files ship.

- `--font-sans`: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- `--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` — addresses, hashes, the launch id and source commit (`.mono`, always with `translate="no"`).

Scale (rem): `--text-xs` 13px captions and hints · `--text-sm` 14px UI text, labels,
buttons, table cells · `--text-base` 16px body and inputs (inputs stay 16px at every
width to avoid iOS zoom) · `--text-lg` 20px `h2` · `--text-xl` 24px stat values ·
`--text-2xl` 30px `h1`. `h3` uses 16px/650 so form and chart titles sit below `h2`.

Weights: 400 body, 500 chips and small buttons, 600 labels, buttons, stat values,
650 headings, 700 `h1`. Line height 1.5 body, 1.15 headings, 1.2 stat values.
Headings use `text-wrap: balance`, paragraphs `text-wrap: pretty` and a 68ch measure
(`p { max-width: 68ch }`), notes 72ch. All numeric values carry `.num`
(`font-variant-numeric: tabular-nums`). Long addresses and status text use
`overflow-wrap: anywhere`. The eyebrow ("PIGY · Sepolia testnet") is 13px uppercase with
0.06em tracking.

## Layout

- Content width `--content-max` 64rem, centered, `padding-inline` 16px (safe-area aware) rising to 24px at ≥40rem.
- Spacing scale `--space-1…12` (4, 8, 12, 16, 24, 32, 48px). Cards pad 24px (16px under 24rem), stack with 24px gaps in `main`; inside a card children gap 16px; field parts gap 8px. Gaps between groups are at least 2× gaps within them.
- Grids: `.stats` and `.kv` are `repeat(auto-fit, minmax(min(100%, 11rem|14rem), 1fr))`; `.action-grid` uses `minmax(min(100%, 18rem), 1fr)`, so three forms sit side by side from roughly 60rem, two at tablet widths and one column on phones. No device breakpoints beyond the 40rem padding step and 24rem card padding step.
- Header is a wrapping flex row (title left, wallet control right; the control drops below the title at narrow widths). Footer is a bordered strip.
- Logical properties throughout (`padding-inline`, `inset-inline-start`, `margin-block-start`), so RTL mirrors without changes (not visually verified in RTL).
- Overflow: tables scroll inside `.table-scroll` (which is `position: relative` so hidden accessible text stays clipped); the chart SVG re-measures its container with `ResizeObserver`. Verified: no horizontal scroll at 320, 768 and 1280px and at 200% root font size.

## Elevation & depth

Mostly flat. Cards and the header/footer use a 1px `--color-border` line; cards add
`--shadow-card` (`0 1px 2px rgb(31 27 23 / 0.04), 0 4px 16px rgb(31 27 23 / 0.05)`).
Floating layers (wallet menu, chart tooltip) use `--shadow-pop`
(`0 8px 24px rgb(31 27 23 / 0.14), 0 1px 3px rgb(31 27 23 / 0.08)`). Status blocks
are tonal (background tint) with no border or shadow. z-index: menu 5, skip link 10.

## Shapes

`--radius-sm` 6px (tooltip, skip link, menu items, code), `--radius-md` 10px (buttons,
inputs, menu, status blocks, empty state, chart plot), `--radius-lg` 16px (cards).
Chips are pills (`999px`); the step badges inside buttons and chip dots are circles.
Chart markers are 8px circles (r=4, 12px when active) with a 2px surface ring; the live
price marker is hollow.

## Components

All in `web/src/components/` unless noted; styles in `web/src/styles.css`.

- **Button** (`.btn` + `.btn-primary | .btn-secondary | .btn-ghost`, `.btn-small`): min-height 40px (32px small), 14px/600 text, 10px radius. Primary is filled accent, secondary is white with the control border, ghost is accent text on transparent. Disabled buttons turn neutral (`--color-surface-muted` fill, secondary text) and always have an explanatory sentence next to them. Motion: 120ms background transition and `scale(0.96)` on press, only under `prefers-reduced-motion: no-preference`. Hover styles are gated by `@media (hover: hover)`.
- **Chip** (`.chip`, `.chip-ok | .chip-warning | .chip-muted`): pill status label with a dot; used for network state and "No browser wallet detected". Never interactive.
- **WalletControl** (`WalletControl.tsx`): connect button (one wallet) or a `Connect wallet` menu (several EIP-6963 wallets; Escape closes and returns focus), then address + network chip + `Disconnect`, plus the single `Switch to Sepolia` primary control on the wrong chain.
- **Stat** (`Stat.tsx`, `.stat`): `dt` label 14px secondary, `dd` value 24px/600 with a unit and optional hint; full-precision value in `title`. Used inside `<dl class="stats">`.
- **ActionForm** (`ActionForm.tsx`, `.card.action`): title, description, labeled amount `<input type="text" inputmode="decimal">` with unit suffix and `Max` ghost button, contract preview line, allowance line, numbered step buttons (1 Approve, 2 Act) and a `TxStatusLine`. Inline errors use `aria-invalid` + `aria-describedby`; format errors appear on blur/submit, over-balance errors immediately.
- **TxStatusLine** (`TxStatusLine.tsx`, `.tx-status`): one persistent live region per form (`role="status"`, `role="alert"` only when failed) with spinner, label, phase text, explorer link and `Dismiss`.
- **AddressLink** (`AddressLink.tsx`, `.link.mono`): shortened address/hash, full value in `title`, opens the explorer in a new tab with hidden "(opens the block explorer in a new tab)" text.
- **PriceChart** (`PriceChart.tsx`, `.chart*`): `figure` with heading and description, an SVG line chart (2px teal line, 8px markers with surface ring, hairline solid gridlines, dashed 1.5px segment to the hollow live marker), a crosshair tooltip on pointer move and on keyboard (`role="group"` plot, Arrow/Home/End keys), an empty state and a `<details>` table view with sticky-free horizontal scrolling. Single series, therefore no legend.
- **GetPigy** (`GetPigy.tsx`): explanatory card listing the token and Uniswap v4 addresses from the runtime network block as `AddressLink`s, plus faucet links on testnets.
- **Skip link** (`.skip-link`): first focusable element, visible on focus.

Focus: the browser ring is replaced by `outline: 2px solid var(--color-focus); outline-offset: 2px` on `:focus-visible` everywhere. Forced-colors mode restores system borders on buttons, chips and inputs.

## Do's and don'ts

- Start a new surface as a `section.card`; put the heading in an `h2` and reference it with `aria-labelledby`.
- Use `.btn-primary` for the one action the visitor is expected to take in that card; peers are `.btn-secondary`. Never fade a disabled control; disable it and say why in a sentence.
- Money and shares: format with `formatAmount` (grouping, ≤4–6 decimals) and keep the exact value in `title`; wrap in `.num`.
- New colors go in as a primitive plus a semantic token in `styles.css`; components never use raw hex. Do not put the rose accent on static text or use blue for anything but focus.
- Keep inputs at 16px, labels visible, placeholders as examples only.
- Announce results through the existing status region pattern rather than new `role="alert"` elements.
- Recipe for another page: copy `index.html` and `main.tsx`, render `<App>`-like sections composed of `section.card`, `dl.stats` + `Stat`, `ActionForm`-style forms and `AddressLink`s, and load runtime configuration through `loadDeployment` so addresses and ABIs stay in `imd-deployment.json`.
