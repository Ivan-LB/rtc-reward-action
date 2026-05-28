const https = require('https');
const http  = require('http');

// ── Inputs ────────────────────────────────────────────────────────────────────
const nodeUrl    = process.env.INPUT_NODE_URL    || 'https://50.28.86.131';
const amount     = parseInt(process.env.INPUT_AMOUNT || '5', 10);
const walletFrom = process.env.INPUT_WALLET_FROM || '';
const adminKey   = process.env.INPUT_ADMIN_KEY   || '';
const dryRun     = (process.env.INPUT_DRY_RUN || 'false').toLowerCase() === 'true';
const walletField= process.env.INPUT_WALLET_FIELD || 'RTC Wallet:';

// GitHub context
const prBody     = process.env.PR_BODY   || '';
const prAuthor   = process.env.PR_AUTHOR || '';
const prNumber   = process.env.PR_NUMBER || '';
const prTitle    = process.env.PR_TITLE  || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function setOutput(name, value) {
  process.stdout.write(`::set-output name=${name}::${value}\n`);
}
function info(msg)  { process.stdout.write(`[36mINFO[0m  ${msg}\n`); }
function warn(msg)  { process.stdout.write(`[33mWARN[0m  ${msg}\n`); }
function error(msg) { process.stdout.write(`[31mERROR[0m ${msg}\n`); }

/**
 * Extract wallet address from PR body using the configured field label.
 * Looks for lines like: "RTC Wallet: alice_wallet" or "RTC Wallet:alice_wallet"
 */
function extractWallet(body, field) {
  if (!body) return null;
  const lines = body.split('\n');
  for (const line of lines) {
    const idx = line.toLowerCase().indexOf(field.toLowerCase());
    if (idx !== -1) {
      const after = line.slice(idx + field.length).trim();
      // Extract first token (wallet names/addresses have no spaces)
      const wallet = after.split(/\s+/)[0].replace(/[`'"]/g, '');
      if (wallet.length > 0) return wallet;
    }
  }
  return null;
}

/**
 * Fall back to the author's GitHub username as a wallet name if
 * no explicit wallet is found in the PR body.
 */
function resolveRecipient(body, field, author) {
  const fromBody = extractWallet(body, field);
  if (fromBody) {
    info(`Wallet from PR body: ${fromBody}`);
    return fromBody;
  }
  if (author) {
    warn(`No "${field}" found in PR body — falling back to GitHub username: ${author}`);
    return author;
  }
  return null;
}

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || undefined,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'rtc-reward-action/1.0',
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  info(`RTC Reward Action — PR #${prNumber} by @${prAuthor}`);
  info(`Title: ${prTitle}`);

  // Validate required inputs
  if (!walletFrom) { error('wallet-from is required'); process.exit(1); }
  if (!adminKey)   { error('admin-key is required');   process.exit(1); }
  if (!nodeUrl)    { error('node-url is required');    process.exit(1); }
  if (isNaN(amount) || amount <= 0) { error(`Invalid amount: ${amount}`); process.exit(1); }

  const recipient = resolveRecipient(prBody, walletField, prAuthor);
  if (!recipient) {
    error('Could not determine recipient wallet. Add "RTC Wallet: <name>" to your PR body.');
    process.exit(1);
  }

  info(`Rewarding: ${recipient} ← ${amount} RTC from ${walletFrom}`);
  info(`Node: ${nodeUrl}`);
  if (dryRun) { warn('DRY RUN — no transaction will be sent'); }

  if (dryRun) {
    info(`[DRY RUN] Would send ${amount} RTC to ${recipient}`);
    setOutput('tx-id', '');
    setOutput('recipient', recipient);
    setOutput('amount-sent', String(amount));
    info('Dry run complete.');
    return;
  }

  // Send reward via RustChain node transfer endpoint
  const payload = {
    from:     walletFrom,
    to:       recipient,
    amount,
    admin_key: adminKey,
    memo:     `PR #${prNumber} merged — automated RTC reward`,
  };

  let res;
  try {
    res = await post(`${nodeUrl.replace(/\/$/, '')}/api/transfer`, payload);
  } catch(e) {
    error(`Network error contacting node: ${e.message}`);
    process.exit(1);
  }

  if (res.status >= 200 && res.status < 300) {
    const txId = res.body?.tx_id || res.body?.txId || '';
    info(`Payment confirmed! tx_id: ${txId || '(none returned)'}`);
    setOutput('tx-id', txId);
    setOutput('recipient', recipient);
    setOutput('amount-sent', String(amount));
    info(`✅ ${amount} RTC sent to ${recipient}`);
  } else {
    error(`Node returned ${res.status}: ${JSON.stringify(res.body)}`);
    process.exit(1);
  }
}

run().catch(e => { error(e.message); process.exit(1); });
