// One bounded foreground command: serve dist/ under /preview/, drive headless Chromium,
// save evidence, shut everything down. No background server survives this process.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/pwmcp/node_modules/playwright-core');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const root = '/home/seat/.identitymd/work/ca3dde2a-ddb3-4177-803f-99c8bcc82250/f5e6c797-a4dc-407e-84bb-68e94761796e';
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'docs', 'validation', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const report = { served: [], console: [], failedRequests: [], pageErrors: [], checks: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/preview/')) {
    res.writeHead(404);
    return res.end('not under /preview/');
  }
  let rel = decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html';
  const file = path.join(dist, rel);
  report.served.push(url.pathname);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('missing');
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
console.log('preview at', base);

// A minimal EIP-6963 wallet that starts on chain 1, does not know Sepolia until asked to add it,
// and rejects every signature with code 4001 so nothing can ever be broadcast.
const TEST_ACCOUNT = '0xe03a1074c86cfedd5c142c4f04f1a1536e203543'; // holds PIGY on Sepolia (pool manager); reads only
const walletScript = `(() => {
  const listeners = {};
  let chainId = '0x1';
  const known = new Set(['0x1']);
  window.__wallet = { requests: [], added: [] };
  const provider = {
    isTestWallet: true,
    on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); },
    removeListener(ev, fn) { listeners[ev]?.delete(fn); },
    async request({ method, params }) {
      window.__wallet.requests.push(method);
      const err = (code, message) => Object.assign(new Error(message), { code });
      switch (method) {
        case 'eth_chainId': return chainId;
        case 'eth_accounts': case 'eth_requestAccounts': return ['${TEST_ACCOUNT}'];
        case 'wallet_switchEthereumChain': {
          const id = params[0].chainId;
          if (!known.has(id)) throw err(4902, 'Unrecognized chain ID');
          chainId = id; listeners.chainChanged?.forEach((f) => f(id)); return null;
        }
        case 'wallet_addEthereumChain': known.add(params[0].chainId); window.__wallet.added.push(params[0]); return null;
        case 'eth_sendTransaction': throw err(4001, 'User rejected the request.');
        default: throw err(4200, 'unsupported ' + method);
      }
    },
  };
  const detail = Object.freeze({ info: { uuid: 'test-1', name: 'Test Wallet', icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>', rdns: 'test.wallet' }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();`;

const browser = await chromium.launch();
const shot = async (page, name, fullPage = false) => {
  const file = path.join(outDir, fullPage ? `${name}.jpg` : `${name}.png`);
  await page.screenshot({ path: file, fullPage, ...(fullPage ? { type: 'jpeg', quality: 78 } : {}) });
  console.log('screenshot', path.relative(root, file));
};
const noOverflow = async (page, label) => {
  const { sw, iw, culprits } = await page.evaluate(() => {
    const iw = window.innerWidth;
    const culprits = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.right > iw + 1 && r.width > 0 && !el.closest('.table-scroll'))
      .sort((a, b) => b.r.right - a.r.right)
      .slice(0, 8)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    return { sw: document.documentElement.scrollWidth, iw, culprits };
  });
  check(`no horizontal overflow at ${label}`, sw <= iw, `scrollWidth ${sw} vs innerWidth ${iw}${culprits.length ? ' culprits: ' + culprits.join(' ; ') : ''}`);
};
const runAxe = async (page, label) => {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
  check(`axe violations at ${label}`, results.length === 0, JSON.stringify(results));
  return results;
};

async function newPage(width, height, opts = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...opts });
  await context.addInitScript(walletScript);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') report.console.push(`[${width}px] ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => report.pageErrors.push(`[${width}px] ${e.message}`));
  page.on('requestfailed', (r) => report.failedRequests.push(`[${width}px] ${r.url()} ${r.failure()?.errorText}`));
  return { context, page };
}

// ---------- Desktop: disconnected state, live reads, keyboard walk, axe ----------
{
  const { context, page } = await newPage(1280, 900);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Vault', exact: true }).waitFor();
  await page.getByText('Share price', { exact: true }).waitFor({ timeout: 30000 });
  const stats = await page.locator('.stats .stat').allInnerTexts();
  check('live vault reads rendered from public RPC', stats.length >= 6, stats.join(' | ').replace(/\n/g, ' '));
  const price = await page.locator('.stats .stat').first().innerText();
  check('share price shows 1 PIGY per vPIGY (fresh vault)', /\b1\b/.test(price), price.replace(/\n/g, ' '));
  const hist = await page.locator('figure.chart').innerText();
  check('price history empty state explains next step', /No price history yet/.test(hist), '');
  await noOverflow(page, '1280px');
  await shot(page, 'desktop-1280-disconnected', true);

  // Keyboard walk over the first stops
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor };
    });
    stops.push(info);
  }
  check('first Tab stop is the skip link', stops[0]?.name === 'Skip to content', JSON.stringify(stops[0]));
  check('focus-visible ring rendered on keyboard focus', stops.filter((s) => s.tag !== 'BODY').every((s) => /solid 2px/.test(s.outline)), stops.map((s) => `${s.tag}:${s.name}:${s.outline}`).join(' ; '));
  await page.keyboard.press('Shift+Tab');
  for (let i = 0; i < 13; i++) await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab'); // skip link focused
  await shot(page, 'desktop-1280-focus-skip-link');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await shot(page, 'desktop-1280-focus-connect');

  const axe1 = await runAxe(page, '1280px disconnected');
  report.axeDesktop = axe1;
  fs.writeFileSync(path.join(root, 'docs', 'validation', 'aria-snapshot-desktop.txt'), await page.locator('body').ariaSnapshot());

  // ---------- Connect on wrong chain, switch -> 4902 -> add -> switch ----------
  await page.getByRole('button', { name: 'Connect Test Wallet' }).click();
  await page.getByText('Wrong network (chain 1)').waitFor();
  const depositBtn = page.getByRole('form', { name: 'Deposit' }).getByRole('button', { name: /Deposit PIGY/ });
  check('actions disabled on wrong chain', await depositBtn.isDisabled(), '');
  await shot(page, 'desktop-1280-wrong-network');
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await page.locator('.chip-ok', { hasText: 'Sepolia' }).waitFor();
  const w = await page.evaluate(() => window.__wallet);
  check('wallet_addEthereumChain offered after 4902 with network block params', w.added.length === 1 && w.added[0].chainId === '0xaa36a7' && w.added[0].rpcUrls.length === 3, JSON.stringify(w.added[0]));
  check('switch sequence switch→add→switch', w.requests.filter((m) => m.startsWith('wallet_')).join(',') === 'wallet_switchEthereumChain,wallet_addEthereumChain,wallet_switchEthereumChain', w.requests.join(','));

  await page.getByText('Your shares', { exact: true }).waitFor({ timeout: 30000 });
  const pos = await page.locator('section[aria-labelledby="position-heading"]').innerText();
  check('position reads live PIGY balance for connected account', /PIGY balance/.test(pos) && !/…/.test(pos), pos.replace(/\n/g, ' ').slice(0, 160));

  // ---------- Deposit: preview from live RPC, approve step, wallet rejection (no broadcast) ----------
  const form = page.getByRole('form', { name: 'Deposit' });
  await form.getByLabel('Amount to deposit').fill('1');
  await form.getByText(/You receive about/).waitFor({ timeout: 30000 });
  const preview = await form.getByText(/You receive about/).innerText();
  check('deposit preview from previewDeposit()', /1 vPIGY/.test(preview), preview);
  const approve = form.getByRole('button', { name: 'Approve 1 PIGY' });
  check('approve step enabled when allowance is short', await approve.isEnabled(), '');
  check('deposit disabled until approved', await form.getByRole('button', { name: 'Deposit 1 PIGY' }).isDisabled(), '');
  await approve.click();
  await form.locator('.tx-status', { hasText: /cancelled|Failed|Confirmed/ }).waitFor({ timeout: 30000 });
  const status = await form.locator('.tx-status').innerText();
  check('simulation passed and wallet rejection shown calmly', /Request cancelled in the wallet/.test(status) && !/Failed/.test(status), status);
  check('no transaction broadcast', (await page.evaluate(() => window.__wallet.requests.filter((m) => m === 'eth_sendTransaction').length)) === 1 && !/View transaction/.test(status), '');
  await shot(page, 'desktop-1280-connected-deposit-rejected', true);

  // Redeem with zero shares: Max is disabled and typing shows the balance error
  const redeem = page.getByRole('form', { name: 'Redeem' });
  await redeem.getByLabel('Shares to redeem').fill('2');
  await redeem.getByText('That is more vPIGY than the wallet holds.').waitFor();
  check('redeem over balance blocked inline', await redeem.getByRole('button', { name: 'Redeem 2 vPIGY' }).isDisabled(), '');

  report.axeDesktopConnected = await runAxe(page, '1280px connected');
  await context.close();
}

// ---------- 320px reflow ----------
{
  const { context, page } = await newPage(320, 640, { deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Share price', { exact: true }).waitFor({ timeout: 30000 });
  await noOverflow(page, '320px');
  await shot(page, 'mobile-320-top');
  await shot(page, 'mobile-320-full', true);
  const inputSize = await page.evaluate(() => getComputedStyle(document.querySelector('.input')).fontSize);
  check('inputs are 16px on mobile (no iOS zoom)', inputSize === '16px', inputSize);
  const btn = await page.locator('.btn-primary').first().boundingBox();
  check('primary control height >= 40px', btn && btn.height >= 40, JSON.stringify(btn));
  report.axeMobile = await runAxe(page, '320px');
  await context.close();
}

// ---------- 768px intermediate ----------
{
  const { context, page } = await newPage(768, 1024);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Share price', { exact: true }).waitFor({ timeout: 30000 });
  await noOverflow(page, '768px');
  await shot(page, 'tablet-768-full', true);
  await context.close();
}

// ---------- reduced motion + 200% text zoom approximation ----------
{
  const { context, page } = await newPage(1280, 900, { reducedMotion: 'reduce' });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Share price', { exact: true }).waitFor({ timeout: 30000 });
  const anim = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'spinner';
    document.body.appendChild(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  check('spinner animation disabled under prefers-reduced-motion', anim === 'none', anim);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.waitForTimeout(200);
  await noOverflow(page, '1280px with 200% root font size');
  await shot(page, 'desktop-1280-200pct-text', true);
  await context.close();
}

// ---------- Chart with data: Snapshot logs stubbed at the RPC layer (the live vault has no events yet) ----------
{
  const VAULT = '0xbfa4a44c30f443bdc635325877a6686d7cddafc6';
  const TOPIC = '0x492fbd8cfdd942203e99f6bc74253a1e1f5791b0644612279e778349f353b198'; // keccak("Snapshot(uint256,uint256)")
  const headRes = await fetch('https://ethereum-sepolia-rpc.publicnode.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const head = BigInt((await headRes.json()).result);
  const now = Math.floor(Date.now() / 1000);
  const E18 = 10n ** 18n;
  const E24 = 10n ** 24n;
  const FAKE = [
    // Blocks must sit inside [deployment block, head]; timestamps are stubbed to spread over days.
    { block: head - 150n, ts: now - 6 * 86400, A: 10n * E18, S: 10n * E24 },
    { block: head - 100n, ts: now - 4 * 86400 - 40000, A: 12n * E18, S: 10n * E24 },
    { block: head - 60n, ts: now - 2 * 86400 - 60000, A: (125n * E18) / 10n, S: 14n * E24 },
    { block: head - 20n, ts: now - 26000, A: 16n * E18, S: 14n * E24 },
  ];
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const pad = (n) => BigInt(n).toString(16).padStart(64, '0');
  const toLog = (p, i) => ({
    address: VAULT,
    topics: [TOPIC],
    data: '0x' + pad(p.A) + pad(p.S),
    blockNumber: hex(p.block),
    blockHash: '0x' + '11'.repeat(32),
    transactionHash: '0x' + 'ab'.repeat(31) + i.toString(16).padStart(2, '0'),
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
  });
  const { context, page } = await newPage(1280, 900);
  await context.route(/publicnode|ethpandaops|sentio/, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = JSON.parse(req.postData());
    const list = Array.isArray(body) ? body : [body];
    const real = await route.fetch();
    const realJson = await real.json();
    const byId = new Map((Array.isArray(realJson) ? realJson : [realJson]).map((r) => [r.id, r]));
    const out = list.map((r) => {
      if (r.method === 'eth_getLogs') {
        const f = r.params[0];
        const from = BigInt(f.fromBlock);
        const to = BigInt(f.toBlock);
        return { jsonrpc: '2.0', id: r.id, result: FAKE.map(toLog).filter((l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to) };
      }
      if (r.method === 'eth_getBlockByNumber' && String(r.params[0]).startsWith('0x')) {
        const p = FAKE.find((q) => q.block === BigInt(r.params[0]));
        if (p) return { jsonrpc: '2.0', id: r.id, result: { ...(byId.get(r.id)?.result ?? {}), number: hex(p.block), timestamp: hex(p.ts) } };
      }
      return byId.get(r.id);
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? out : out[0]) });
  });
  const seen = [];
  page.on('response', async (res) => {
    if (/publicnode|ethpandaops|sentio/.test(res.url())) {
      try {
        const body = await res.text();
        if (/getLogs|"logIndex"/.test(body) || seen.length < 3) seen.push(body.slice(0, 300));
      } catch {}
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  const fig = page.locator('figure.chart');
  try {
    await page.getByText(/4 snapshots;/).waitFor({ timeout: 45000 });
  } catch (e) {
    console.log('CHART DEBUG figure text:', (await fig.innerText()).replace(/\n/g, ' '));
    console.log('CHART DEBUG rpc:', seen.join('\n---\n'));
    throw e;
  }
  const svgFits = async (label) => {
    const m = await page.evaluate(() => ({ plot: document.querySelector('.chart-plot').clientWidth, svg: document.querySelector('.chart-plot svg').getBoundingClientRect().width, attr: Number(document.querySelector('.chart-plot svg').getAttribute('width')) }));
    check(`chart SVG measures its container at ${label}`, Math.abs(m.plot - m.attr) <= 2 && Math.abs(m.plot - m.svg) <= 2, JSON.stringify(m));
  };
  await svgFits('1280px');
  await fig.scrollIntoViewIfNeeded();
  await fig.screenshot({ path: path.join(outDir, 'chart-1280-data.png') });
  const plot = page.locator('.chart-plot');
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.locator('.tooltip:not(.tooltip-hidden)').waitFor();
  const tip = await page.locator('.tooltip:not(.tooltip-hidden)').innerText();
  check('chart crosshair tooltip shows price and time on hover', /PIGY/.test(tip), tip.replace(/\n/g, ' '));
  await fig.screenshot({ path: path.join(outDir, 'chart-1280-hover.png') });
  await plot.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const tipKb = await page.locator('.tooltip:not(.tooltip-hidden)').innerText();
  check('chart keyboard navigation moves the readout', /PIGY/.test(tipKb) && tipKb !== tip, tipKb.replace(/\n/g, ' '));
  await page.getByText('Show snapshots as a table').click();
  check('table view lists every snapshot', (await page.locator('tbody tr').count()) === 4, '');
  await fig.screenshot({ path: path.join(outDir, 'chart-1280-table.png') });
  report.axeChart = await runAxe(page, '1280px chart with data');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(300);
  await noOverflow(page, '320px chart with data');
  await svgFits('320px');
  await fig.screenshot({ path: path.join(outDir, 'chart-320-data.png') });
  await context.close();
}

await browser.close();
server.close();

check('no page errors', report.pageErrors.length === 0, report.pageErrors.join(' | '));
check('no console errors/warnings', report.console.length === 0, report.console.join(' | '));
check('no failed resource requests', report.failedRequests.length === 0, report.failedRequests.join(' | '));
const relAssets = report.served.filter((p) => p.startsWith('/preview/'));
check('all assets loaded relative to /preview/ subpath', relAssets.some((p) => p.includes('/preview/assets/')) && relAssets.some((p) => p.endsWith('/preview/imd-deployment.json')) && relAssets.some((p) => p.includes('/preview/abi/')), [...new Set(relAssets)].join(' '));
fs.writeFileSync(path.join(root, 'docs', 'validation', 'browser-report.json'), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
