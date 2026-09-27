# Frontend validation record — Piggy Vault (`lab-donation-vault`)

Worker-side evidence for the frontend stage. This is the worker's report, not an
independent network certification. Commands were run on 2026-09-27 from `web/`
(Node 24.9.0, npm 11.6.0) and from `test/scratch/` for the browser run.

## 1. Scope and assumptions

- **Pages/flows:** the single page in `dist/index.html`: wallet connect/disconnect, wrong-network → switch → add-chain, live vault reads, wallet position, deposit (approve + deposit), redeem, donate (approve + donate), transaction status, Snapshot share-price chart with table view, "Getting PIGY" explanation.
- **Export:** `dist/` built by `npm run export` (Vite 7.3.6, base `./`) plus `dist/imd-deployment.json` from `web/scripts/manifest.mjs`.
- **Handoff:** `.imd/reads/deployment.json` (launch `4b813316-…`, Sepolia 11155111, source commit `11f58db8…`, two contracts) and `.imd/reads/network.json`; copies are committed as `web/deployment/*.json` so the export can be rebuilt after the reads directory is removed.
- **ABIs:** `docs/abi/*.json` at the pinned commit (HEAD is that commit). Canonical Keccak (sorted-key compact JSON) equals the handoff `abiHash` for both contracts; the manifest script and a unit test enforce this.
- **Consequential inferred choices:**
  - No in-page swap. `workflow.md` states "no in-page swap" and asks the page to say PIGY comes from swapping Sepolia ETH in the launch pool; the generic acceptance clause about swaps therefore has nothing to apply to. The Uniswap v4 addresses are still read from the runtime `network` block and shown with explorer links.
  - `wallet_addEthereumChain` parameters are derived from the manifest's `network` block (identical to `walletAddChain` in `network.json`; asserted by a unit test) so the app has one source of chain data.
  - The deployment block for log scans (`11791684`) lives in `web/src/config.ts` because the manifest schema is fixed; the manifest script refuses to build if it drifts from the handoff.
  - `DESIGN.md` is at `docs/DESIGN.md`: the assignment's write scope excludes the repository root.
  - Light theme only; no dark theme, no localisation, no dialogs beyond the wallet chooser menu.
- **Exclusions:** no real transaction was broadcast (no funded key; not authorised). WalletConnect not configured.

## 2. Coverage (Better Interface, six domains)

| Domain | Status | Inspected states and evidence | Not verified |
| --- | --- | --- | --- |
| Accessibility | Checked | Accessible names/roles via `aria-snapshot-desktop.txt`; axe-core 4 runs (1280 disconnected, 1280 connected, 320, 1280 chart) with 0 violations; keyboard walk of 13 stops with visible 2px focus ring (`desktop-1280-focus-*.png`); skip link first; labels bound to inputs; `aria-invalid`/`aria-describedby` on errors; one persistent `role="status"` per form; spinner animation `none` under `prefers-reduced-motion: reduce`; inputs 16px on mobile; 200% root font size reflow | Real screen-reader session; forced-colors rendering; browser-native 200% zoom (approximated by 200% root font size); physical touch device |
| Layout | Checked | No horizontal overflow at 320, 768, 1280 and 1280@200% font; grids collapse 4→2→1 (`mobile-320-full.jpg`, `tablet-768-full.jpg`, `desktop-1280-disconnected.jpg`); header wraps; table scrolls inside its container | RTL mirror (logical properties used, not rendered); widths between the sampled ones |
| Writing | Checked | Source review of every label, error and empty state: verb-first buttons, sentence case, errors state the fix ("Use digits and one decimal point, for example 12.5."), links describe destination, one vocabulary (Approve/Deposit/Redeem/Donate) | — |
| Typography | Checked | Heading sizes descend (30/20/16), weights ≥400, tabular numerals on values, 68ch measure, `text-wrap` balance/pretty; wrapping of long addresses and the 800M balance observed in screenshots | Font rendering on macOS/iOS |
| Colors | Checked | All declared foreground/background pairs computed (`contrast.mjs`): body 17.1:1, secondary 7.35:1, white-on-accent 6.41:1, links 6.41:1, focus 6.6:1, statuses 5.5–6.3:1, control border 3.88:1, chart line 4.98:1. No alpha or gradient text, so rendered pairs equal declared pairs | Pixel-sampled measurement of the rendered page; dark mode (not shipped) |
| UI | Checked | States walked in browser: disabled (neutral fill + reason text), enabled primary/secondary, wrong-network chip, status info/ok/cancel, empty chart, chart hover tooltip, keyboard readout, table view; press scale and 120ms transitions read from source | Motion replay at 10% speed; hover on touch (gated by `hover: hover` in source) |

## 3. Findings and fixes

Ordered by severity; all fixed and rechecked before the final export.

| # | Sev. | Location | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH | `web/src/components/PriceChart.tsx` `useWidth` | Chart SVG stayed at its 640px default and was scaled down at 320px (first `chart-320-data.png` run); the observer was created in a mount effect before the plot existed | Callback ref creates the `ResizeObserver` when the plot mounts | Browser check "chart SVG measures its container" 926/926 at 1280, 254/254 at 320 |
| 2 | HIGH | `web/src/styles.css` `.table-scroll` | `documentElement.scrollWidth` 815 at 320px with the table open; `.sr-only` spans inside table links were positioned against the page | `position: relative` on the scroll container | scrollWidth 320 at 320px with table open |
| 3 | HIGH | `web/src/snapshots.ts` `scanSnapshots` | After a confirmed deposit the chart did not pick up the new Snapshot (interaction test); viem cached the block number for 4 s | `getBlockNumber({ cacheTime: 0 })` | Test "requires an approval step, then deposits and records a snapshot" passes |
| 4 | MEDIUM | `web/src/styles.css` `--color-border-strong` on `.input`/`.btn-secondary` | Control boundary 1.69:1 on white (below 3:1) | New `--color-border-control` `#8a8073` (3.88:1) | Recomputed 3.88:1 / 3.38:1 on muted surface |
| 5 | MEDIUM | `web/src/components/ActionForm.tsx` `fieldError` | Over-balance amount disabled the button with no visible reason until blur (browser run: Redeem `2` with 0 shares) | Over-balance error shows as soon as the amount parses; format errors still wait for blur/submit | "redeem over balance blocked inline" passes |
| 6 | MEDIUM | `web/src/styles.css` `.btn:disabled` | Disabled primary buttons drew the accent at 55% opacity and read as almost live (first `desktop-1280-disconnected` screenshot) | Neutral disabled fill and text | Final `desktop-1280-disconnected.jpg` |
| 7 | MEDIUM | `web/src/components/PriceChart.tsx` empty state | Empty state was suppressed when the live price point existed, leaving a lone hollow marker | Empty state keyed on snapshot count | "price history empty state explains next step" passes |
| 8 | LOW | `web/src/hooks/useTransaction.ts`, `TxStatusLine.tsx` | Wallet cancel (4001) rendered as "Failed." in a `role="alert"` | Separate `cancelled` phase, polite status, calm copy | Browser: "Approve 1 PIGY: Request cancelled in the wallet. Nothing was sent." |

## 4. Verification

### Commands and outcomes

| Command (from `web/`) | Result |
| --- | --- |
| `npm ci` / `npm install` | 233 packages, no vulnerabilities reported by npm |
| `npm run typecheck` | exit 0, no errors |
| `npm test` | 2 files, 20 tests passed (vitest 3.2.4, jsdom) |
| `npm run export` | `vite build` ok; manifest: 2 contracts, 7 assets, 588 382 bytes of assets, both ABI hashes verified |
| `node test/scratch/browser-check.mjs` (copy in `docs/validation/browser-check.mjs`) | 36/36 checks passed; report in `browser-report.json` |

Bundle: `assets/index-*.js` ≈ 548 kB (≈170 kB gzip), CSS 12.7 kB. Export total ≈ 0.6 MB, far below the checker budget.

### Interaction tests (`web/src/test/`, mocked chain and wallet)

`fakeChain.ts` implements the vault's ERC-4626 math with the 6-decimal offset, the seven-day
stream, custom-error reverts, logs, receipts, `eth_getLogs` range limits and `wallet_*`
methods behind an EIP-1193 `request`. The real app runs against it through viem's
`custom` transport. Covered: manifest/ABI loading and validation, missing-manifest error,
connect/disconnect, wrong chain → `wallet_switchEthereumChain` 4902 → `wallet_addEthereumChain`
(params equal `walletAddChain`) → switch, approve gating, deposit with preview and Snapshot
pickup, redeem via Max, donate with unvested/lock-end display and overlapping-donation
merge, wallet rejection (4001), simulated revert shown before signing (`ZeroDonation`),
inline validation and over-balance blocking, canonical ABI hashing, manifest refusal of a
tampered ABI, relative `abiPath` enforcement, chunked log scanning with range halving.

### Browser run (headless Chromium 1246 via Playwright 1.64, export served under `/preview/`)

Viewports 1280×900, 768×1024, 320×640 (mobile emulation), 1280 with reduced motion and
200% root font size. A stub EIP-6963 wallet starting on chain 1 was injected; it answers
`eth_requestAccounts`, throws 4902 until the chain is added, and rejects every
`eth_sendTransaction` with 4001, so nothing was broadcast. All reads, previews and
simulations went to the real Sepolia public RPCs from the network block.

Observed live: chain id 11155111, vault code present, `token()` = `0x45f5…eeCb`,
share price 1 PIGY/vPIGY, zero supply, no donation yet, `previewDeposit(1 PIGY)` = 1 vPIGY,
the pool manager account's PIGY balance, `approve` simulation success followed by the
wallet's rejection. Because the live vault has emitted no Snapshot yet, the chart with
data was rendered by stubbing `eth_getLogs`/`eth_getBlockByNumber` at the request layer
with four synthetic snapshots (`chart-*.png`).

Screenshots (`docs/validation/screenshots/`): `desktop-1280-disconnected.jpg`,
`desktop-1280-focus-skip-link.png`, `desktop-1280-focus-connect.png`,
`desktop-1280-wrong-network.png`, `desktop-1280-connected-deposit-rejected.jpg`,
`tablet-768-full.jpg`, `mobile-320-top.png`, `mobile-320-full.jpg`,
`desktop-1280-200pct-text.jpg`, `chart-1280-data.png`, `chart-1280-hover.png`,
`chart-1280-table.png`, `chart-320-data.png`. Console errors/warnings: none. Failed
requests: none. All assets resolved relative to the `/preview/` subpath.

Note: the IMD browser launcher's `test/scratch/browser/preview.json` was not present and the
MCP browser's code-execution tool was not permitted, so the run used the guide's other
sanctioned path: one foreground script that owns its preview server and browser.

## 5. Untested live-chain behaviour and limitations

- No transaction was broadcast: real `approve`, `deposit`, `redeem` and `donate` on Sepolia are untested end to end. Their encoding, simulation and receipt handling are covered by the mocked suite, and simulation of `approve` against the live RPC succeeded.
- `wallet_addEthereumChain` was exercised with the stub wallet, not with MetaMask or another production wallet.
- The live Snapshot history is empty today; chart rendering with events was verified with RPC-layer stubs, and event decoding against the real ABI is covered by the vitest scan test.
- RPC fallback rotation across the three public endpoints was not forced; log-range halving was verified against the fake RPC only.
- Screen-reader announcements, forced-colors mode, native browser zoom, RTL rendering and physical devices were not verified (see coverage table).

## 6. Completion

**Complete for the stated scope.** Build, typecheck, interaction tests and browser
inspection ran on the final source; all reported findings were fixed and rechecked; the
export and `dist/imd-deployment.json` were regenerated after the last source change. The
limitations above are stated, not hidden. Publication (IPFS pin, naming, control-plane
hash checks) is the publisher's step and is not claimed here.
