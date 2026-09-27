import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { ALICE, CHAIN_ID, FakeChain, VAULT } from './fakeChain';
import { testEnv } from './testEnv';

const PIGY = 10n ** 18n;

async function renderApp(chain: FakeChain, opts: Parameters<typeof testEnv>[1] = {}) {
  const env = testEnv(chain, opts);
  const user = userEvent.setup();
  render(<App env={env} />);
  await screen.findByRole('heading', { name: 'Vault' });
  await waitFor(() => expect(screen.getByText('Share price')).toBeInTheDocument());
  return { user, env };
}

function form(name: string) {
  return within(screen.getByRole('form', { name }));
}

describe('deployment configuration', () => {
  it('loads addresses, chain and ABIs from imd-deployment.json and reads live vault state', async () => {
    const chain = new FakeChain();
    await renderApp(chain, { wallets: 'none' });
    // Explorer link to the handoff vault address and the token address read from vault.token()
    const links = screen.getAllByRole('link', { name: /0xbfa4…afc6/i });
    expect(links[0]).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${VAULT.toLowerCase()}`);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0); // share price 1 PIGY per vPIGY
    expect(screen.getByText('No donation yet')).toBeInTheDocument();
    expect(screen.getByText('No browser wallet detected')).toBeInTheDocument();
    expect(screen.getByText('No price history yet')).toBeInTheDocument();
    // Uniswap addresses in the Getting PIGY section come from the network block
    expect(screen.getByRole('link', { name: /0x3a9d…f98b/i })).toHaveAttribute('href', 'https://sepolia.etherscan.io/address/0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b');
    expect(chain.requests.some((r) => r.method === 'eth_getLogs')).toBe(true);
  });

  it('shows a clear error when the manifest is missing', async () => {
    const chain = new FakeChain();
    const env = { ...testEnv(chain), fetchJson: async () => { throw new Error('Unable to load imd-deployment.json (HTTP 404)'); } };
    render(<App env={env} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the deployment configuration');
  });
});

describe('wallet and network', () => {
  it('connects, shows the address and position, and disconnects', async () => {
    const chain = new FakeChain();
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    expect(await screen.findByText(/0x0000…11ce/i)).toBeInTheDocument();
    expect(await screen.findByText('PIGY balance')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByRole('button', { name: 'Connect Fake Wallet' })).toBeInTheDocument();
  });

  it('offers wallet_addEthereumChain when switching fails with 4902, then switches', async () => {
    const chain = new FakeChain({ walletChainId: 1 });
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    expect(await screen.findByText('Wrong network (chain 1)')).toBeInTheDocument();
    expect(form('Deposit').getByText(/Switch the wallet to Sepolia/)).toBeInTheDocument();
    expect(form('Deposit').getByRole('button', { name: /Deposit PIGY/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    await waitFor(() => expect(chain.walletChainId).toBe(CHAIN_ID));
    const methods = chain.requests.map((r) => r.method).filter((m) => m.startsWith('wallet_'));
    expect(methods).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    const add = chain.requests.find((r) => r.method === 'wallet_addEthereumChain')!.params as [Record<string, unknown>];
    expect(add[0]).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.ethpandaops.io', 'https://sepolia.rpc.sentio.xyz'],
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    });
    expect(await screen.findByText('Sepolia', { selector: '.chip' })).toBeInTheDocument();
  });
});

describe('deposit, redeem and donate', () => {
  it('requires an approval step, then deposits and records a snapshot', async () => {
    const chain = new FakeChain();
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('PIGY balance');

    const f = form('Deposit');
    const input = f.getByLabelText('Amount to deposit');
    await user.type(input, '10');
    await waitFor(() => expect(f.getByText(/You receive about/)).toHaveTextContent('10 vPIGY'));

    const approve = f.getByRole('button', { name: 'Approve 10 PIGY' });
    const deposit = f.getByRole('button', { name: 'Deposit 10 PIGY' });
    expect(approve).toBeEnabled();
    expect(deposit).toBeDisabled();

    await user.click(approve);
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Approve 10 PIGY: Confirmed.'));
    expect(chain.allowance(ALICE, VAULT)).toBe(10n * PIGY);
    await waitFor(() => expect(f.getByRole('button', { name: 'Deposit 10 PIGY' })).toBeEnabled());

    await user.click(f.getByRole('button', { name: 'Deposit 10 PIGY' }));
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Deposit 10 PIGY: Confirmed.'));
    expect(chain.sharesOf(ALICE)).toBe(10n * 10n ** 24n);
    expect(f.getByRole('link', { name: /View transaction/ })).toHaveAttribute('href', expect.stringContaining('https://sepolia.etherscan.io/tx/0x'));

    // Live reads refreshed after confirmation
    await waitFor(() => expect(screen.getByText('Your shares').nextSibling).toHaveTextContent('10'));
    expect(screen.getByText('Share value').nextSibling).toHaveTextContent('10');
    // Snapshot history picked up the new event
    await waitFor(() => expect(screen.getByText(/1 snapshot;/)).toBeInTheDocument());
    await user.click(screen.getByText('Show snapshots as a table'));
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('10');
  });

  it('redeems all shares back to PIGY using the Max button', async () => {
    const chain = new FakeChain();
    chain.allowances.set(`${ALICE.toLowerCase()}:${VAULT.toLowerCase()}`, 10n ** 30n);
    chain.request('eth_sendTransaction', [{ from: ALICE, to: VAULT, data: depositData(25n * PIGY) }]);
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('Your shares');

    const f = form('Redeem');
    await user.click(f.getByRole('button', { name: /^Max: 25 vPIGY/ }));
    await waitFor(() => expect(f.getByText(/You receive about/)).toHaveTextContent('25 PIGY'));
    await user.click(f.getByRole('button', { name: 'Redeem 25 vPIGY' }));
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Confirmed.'));
    expect(chain.sharesOf(ALICE)).toBe(0n);
    expect(chain.balanceOf(ALICE)).toBeGreaterThan(999n * PIGY);
  });

  it('donates and shows the unvested amount and lock end falling over time', async () => {
    const chain = new FakeChain();
    chain.allowances.set(`${ALICE.toLowerCase()}:${VAULT.toLowerCase()}`, 10n ** 30n);
    const { user, env } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('Your shares');

    const f = form('Donate');
    await user.type(f.getByLabelText('Amount to donate'), '7');
    expect(f.getByText(/Unlocks over 7 days/)).toBeInTheDocument();
    await user.click(f.getByRole('button', { name: 'Donate 7 PIGY' }));
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Donate 7 PIGY: Confirmed.'));
    await waitFor(() => expect(screen.getByText('Unvested donations').nextSibling).toHaveTextContent('7'));
    expect(screen.getByText('Lock end').nextSibling).toHaveTextContent('7 d remaining');
    expect(screen.getByText('Vested assets').nextSibling).toHaveTextContent('0');

    // Half a week later the stream has released half; a second donation merges and restarts it.
    chain.advanceTime(302_400n);
    expect(chain.unvested()).toBe(35n * 10n ** 17n);
    await user.click(f.getByRole('button', { name: 'Dismiss' }));
    await user.type(f.getByLabelText('Amount to donate'), '1');
    await user.click(f.getByRole('button', { name: 'Donate 1 PIGY' }));
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Donate 1 PIGY: Confirmed.'));
    // 3.5 PIGY remaining minus the 12 s the mined block advanced, plus the new 1 PIGY.
    expect(chain.lockedAmount).toBeGreaterThan(4_499n * 10n ** 15n);
    expect(chain.lockedAmount).toBeLessThan(45n * 10n ** 17n);
    await waitFor(() => expect(screen.getByText('Unvested donations').nextSibling).toHaveTextContent(/4\.49/));
    expect(env.now()).toBe(Number(chain.timestamp) * 1000);
  });

  it('shows a calm message when the wallet rejects the signature', async () => {
    const chain = new FakeChain();
    chain.allowances.set(`${ALICE.toLowerCase()}:${VAULT.toLowerCase()}`, 10n ** 30n);
    chain.rejectSendWith = 4001;
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('Your shares');
    const f = form('Deposit');
    await user.type(f.getByLabelText('Amount to deposit'), '3');
    await waitFor(() => expect(f.getByRole('button', { name: 'Deposit 3 PIGY' })).toBeEnabled());
    await user.click(f.getByRole('button', { name: 'Deposit 3 PIGY' }));
    await waitFor(() => expect(f.getByRole('status')).toHaveTextContent('Deposit 3 PIGY: Request cancelled in the wallet. Nothing was sent.'));
    expect(f.queryByRole('alert')).toBeNull(); // a cancel is not an error
  });

  it('surfaces a simulated revert before the wallet opens', async () => {
    const chain = new FakeChain();
    chain.allowances.set(`${ALICE.toLowerCase()}:${VAULT.toLowerCase()}`, 10n ** 30n);
    chain.forceRevert = { functionName: 'donate', errorName: 'ZeroDonation' };
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('Your shares');
    const f = form('Donate');
    await user.type(f.getByLabelText('Amount to donate'), '2');
    await user.click(f.getByRole('button', { name: 'Donate 2 PIGY' }));
    expect(await f.findByRole('alert')).toHaveTextContent('Enter a donation greater than zero.');
    expect(chain.requests.some((r) => r.method === 'eth_sendTransaction')).toBe(false);
  });

  it('validates the amount inline and blocks amounts above the balance', async () => {
    const chain = new FakeChain();
    const { user } = await renderApp(chain);
    await user.click(screen.getByRole('button', { name: 'Connect Fake Wallet' }));
    await screen.findByText('Your shares');
    const f = form('Deposit');
    const input = f.getByLabelText('Amount to deposit');
    await user.type(input, 'abc');
    await user.click(f.getByRole('button', { name: /Deposit/ }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(f.getByText('Use digits and one decimal point, for example 12.5.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '5000');
    expect(await f.findByText('That is more PIGY than the wallet holds.')).toBeInTheDocument();
    expect(f.getByRole('button', { name: 'Approve 5,000 PIGY' })).toBeDisabled();
  });
});

// Helper: ABI-encode a deposit call for pre-seeding vault state.
import { encodeFunctionData } from 'viem';
import { vaultAbi } from './fakeChain';
function depositData(assets: bigint) {
  return encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [assets, ALICE] });
}
