// Central non-secret configuration.
//
// Contract addresses, the chain id, ABIs, public RPC URLs, the explorer and the
// Uniswap v4 addresses are NOT defined here: the app loads them at runtime from
// ./imd-deployment.json (generated from the validated deployment handoff by
// scripts/manifest.mjs) so there is exactly one copy that can never disagree
// with the attested deployment. See deployment.ts.

/** Path of the runtime deployment configuration, relative to index.html. */
export const DEPLOYMENT_MANIFEST_PATH = 'imd-deployment.json';

/**
 * Block in which LaunchToken and DonationVault4626 were deployed (handoff blockNumber).
 * Event scans start here. scripts/manifest.mjs fails the export if this drifts from the handoff.
 */
export const DEPLOYMENT_BLOCK = 11791684n;

/** eth_getLogs range per request; halved automatically when a public RPC rejects a range. */
export const LOG_CHUNK_BLOCKS = 10_000n;
export const MIN_LOG_CHUNK_BLOCKS = 250n;

/** How often live vault and wallet reads refresh, in milliseconds. */
export const REFRESH_INTERVAL_MS = 15_000;

/** How often the app polls for a transaction receipt, in milliseconds. */
export const RECEIPT_POLL_MS = 2_000;

/** Contract names as they appear in the handoff / manifest. */
export const VAULT_CONTRACT = 'DonationVault4626';
export const TOKEN_CONTRACT = 'LaunchToken';

/**
 * Optional WalletConnect project id. Not configured: the app ships with browser-wallet
 * (EIP-6963 / window.ethereum) connectors only. Supplying one would require adding the
 * WalletConnect connector; it is a public identifier, never a secret.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined = undefined;
