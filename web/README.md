# Piggy Vault frontend (`lab-donation-vault`)

One static page to deposit, redeem and donate PIGY in `DonationVault4626` on Sepolia,
with live vault state, the connected wallet's position and a share-price history built
from `Snapshot` events. Vite + React + TypeScript + viem. No backend, no indexer.

## Layout of this directory

| Path | Purpose |
| --- | --- |
| `src/config.ts` | Non-secret constants: manifest path, deployment block for log scans, chunk sizes, refresh intervals, optional WalletConnect id (unset). |
| `src/deployment.ts` | Loads and validates `imd-deployment.json` at runtime; derives the viem chain, explorer URLs and `wallet_addEthereumChain` params from its `network` block. **The only source of addresses, chain id, RPC URLs, Uniswap addresses and ABIs.** |
| `src/env.ts` | Browser environment: JSON fetcher, public RPC transport (`fallback` over the network's RPC URLs with batching), EIP-6963 wallet discovery with `window.ethereum` fallback. Tests substitute a fake. |
| `src/wallet.ts` | Wallet connection, account/chain tracking, `wallet_switchEthereumChain` → `wallet_addEthereumChain` (on code 4902) → switch again. |
| `src/vault.ts`, `src/snapshots.ts` | Typed reads over the runtime ABIs; chunked `eth_getLogs` scan from the deployment block with automatic range halving. |
| `src/hooks/` | `useVaultData` (live reads, position, snapshot history), `useTransaction` (simulate → sign → wait → refresh). |
| `src/components/` | Wallet control, stats, action forms, transaction status, price chart, "Getting PIGY" card. |
| `deployment/handoff.json`, `deployment/network.json` | Copies of the workflow handoff and vetted chain entry. Build inputs for the manifest only; the app never imports them. |
| `public/abi/*.json` | Implementation-derived ABIs from the pinned source commit `11f58db8…`, copied verbatim from `docs/abi/`. |
| `scripts/manifest.mjs`, `scripts/manifest-lib.mjs` | Generate `../dist/imd-deployment.json` after a build; verify each ABI's canonical Keccak hash against the handoff and hash every exported file. |
| `src/test/` | Vitest suite with an in-memory EVM/wallet fake (`fakeChain.ts`). |

The production export is committed at the repository root `dist/` (relative base `./`,
works from a gateway subpath or a plain folder).

## Configuration

Runtime configuration is `dist/imd-deployment.json`:

```json
{ "version": 1, "launchId": "…", "chainId": 11155111, "sourceCommit": "…", "attestationHash": "…",
  "contracts": [{ "name": "LaunchToken", "address": "0x…", "abiHash": "…", "abiPath": "abi/LaunchToken.json" },
                { "name": "DonationVault4626", "address": "0x…", "abiHash": "…", "abiPath": "abi/DonationVault4626.json" }],
  "assets": [{ "path": "index.html", "sha256": "…" }, …],
  "network": { "chainId": 11155111, "name": "Sepolia", "rpcUrls": […], "explorer": "…", "uniswapV4": { … } } }
```

The page fetches it relative to `index.html`, then fetches each `abiPath`. The PIGY
address is read from `DonationVault4626.token()`; the manifest's `LaunchToken` entry
supplies the ERC-20 ABI. Public RPC URLs, the explorer and the Uniswap v4 addresses come
from `network`. There are no private credentials anywhere. To retarget a new deployment,
replace `deployment/handoff.json` (and `deployment/network.json` if the chain changes),
update `DEPLOYMENT_BLOCK` in `src/config.ts` (the manifest script refuses a mismatch),
refresh `public/abi/` and rebuild.

WalletConnect is not configured; the app offers browser wallets discovered through
EIP-6963 plus the legacy `window.ethereum`. Adding WalletConnect would mean installing
its connector and setting `WALLETCONNECT_PROJECT_ID` in `src/config.ts` (a public id).

## Install, develop, build

Requires Node 20+ (built with Node 24.9, npm 11).

```sh
cd web
npm ci                # install from package-lock.json
npm run dev           # dev server; imd-deployment.json is generated in memory from deployment/
npm run typecheck     # tsc --noEmit
npm test              # vitest (jsdom, mocked chain and wallet)
npm run build         # vite build → ../dist (cleans it first)
npm run manifest      # writes ../dist/imd-deployment.json with ABI hash checks and asset SHA-256s
npm run export        # build + manifest
npm run check         # typecheck + test + export
npm run preview       # serve ../dist locally
```

Always run `npm run export` (or `npm run manifest`) after any change that touches the
export, and commit `dist/` together with the source. The manifest excludes itself from
its asset list.

## Behaviour notes

- Every paying action (deposit, donate) shows an explicit **Approve** step when the PIGY allowance to the vault is short; redeem needs no approval.
- Each transaction is `simulateContract`-ed with the connected account before the wallet opens; decoded custom errors (`ZeroShares`, `ZeroDonation`, `ReceiverMustBeCaller`, ERC-20/4626 errors) are shown in plain words. A wallet rejection (code 4001) is reported as a cancel, not an error.
- Withdrawals pay the connected wallet only (`redeem(shares, self, self)`), matching the contract's receiver rule.
- The unvested amount is recomputed locally between RPC refreshes using `lockedAmount`, `lockEnd` and `UNLOCK_DURATION`; live reads refresh every 15 s and after every confirmed transaction.
- Snapshot history is scanned from the deployment block in 10 000-block chunks (halved down to 250 when an RPC rejects a range), timestamps come from block headers, and price is `floor(1e24 · (A+1) / (S+1e6))`.
- There is no in-page swap; the approved workflow asks the page to explain that PIGY comes from swapping Sepolia ETH in the launch pool. The Uniswap v4 addresses shown are read from the runtime network block.

## Validation

See `../docs/validation/README.md` for the build, typecheck, test and browser evidence,
the Better Interface review, and what was not tested against the live chain.
