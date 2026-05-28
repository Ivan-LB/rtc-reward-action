const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Inputs ────────────────────────────────────────────────────────────────────
const nodeUrl    = process.env.INPUT_NODE_URL    || 'https://50.28.86.131';
const amount     = parseInt(process.env.INPUT_AMOUNT || '5', 10);
const walletFrom = process.env.INPUT_WALLET_FROM || '';
const adminKey   = process.env.INPUT_ADMIN_KEY   || '';
const dryRun     = (process.env.INPUT_DRY_RUN || 'false').toLowerCase() === 'true';
const walletField= process.env.INPUT_WALLET_FIELD || 'RTC Wallet:';

// GitHub context
const prBody     = process.env.PR_BODY      || '';
const prAuthor   = process.env.PR_AUTHOR    || '';
const prNumber   = process.env.PR_NUMBER    || '';
const prTitle    = process.env.PR_TITLE     || '';
const repoOwner  = process.env.REPO_OWNER   || '';
const repoName   = process.env.REPO_NAME    || '';
const githubToken= process.env.GITHUB_TOKEN || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function setOutput(name, value) {
  process.stdout.write(`::set-output name=${name}::${value}\n`);
}
function info(msg)  { process.stdout.write(`\x1b[36mINFO\x1b[0m  ${msg}\n`); }
function warn(msg)  { process.stdout.write(`\x1b[33mWARN\x1b[0m  ${msg}\n`); }
function error(msg) { process.stdout.write(`\x1b[31mERROR\x1b[0m ${msg}\n`); }

function extractWallet(body, field) {
  if (!body) return null;
  const lines = body.split('\n');
  for (const line of lines) {
    const idx = line.toLowerCase().indexOf(field.toLowerCase());
    if (idx !== -1) {
      const after = line.slice(idx + field.length).trim();
      const wallet = after.split(/\s+/)[0].replace(/[`'"]/g, '');
      if (wallet.length > 0) return wallet;
    }
  }
  return null;
}

function readWalletFile() {
  const filePath = path.join(process.env.GITHUB_WORKSPACE || '.', '.rtc-wallet');
  try {
    const contents = fs.readFileSync(filePath, 'utf8').trim();
    const wallet = contents.split(/\s+/)[0].replace(/[`'"]/g, '');
    if (wallet.length > 0) return wallet;
  } catch (_) {}
  return null;
}

function resolveRecipient(body, field, author) {
  const fromBody = extractWallet(body, field);
  if (fromBody) {
    info(`Wallet from PR body: ${fromBody}`);
    return fromBody;
  }
  const fromFile = readWalletFile();
  if (fromFile) {
    info(`Wallet from .rtc-wallet file: ${fromFile}`);
    return fromFile;
  }
  if (author) {
    warn(`No "${field}" found — falling back to GitHub username: ${author}`);
    return author;
  }
  return null;
}

function request(method, url, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body   = payload ? JSON.stringify(payload) : '';
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || undefined,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'rtc-reward-action/1.0',
        ...extraHeaders,
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
    if (body) req.write(body);
    req.end();
  });
}

async function postPRComment(txId, recipient, amountSent) {
  if (!githubToken || !repoOwner || !repoName || !prNumber) {
    warn('Skipping PR comment — missing GITHUB_TOKEN, REPO_OWNER, REPO_NAME, or PR_NUMBER');
    return;
  }
  const txLine  = txId ? `\n> 🔗 **Tx ID:** \`${txId}\`` : '';
  const comment = `## 🎉 RTC Reward Sent!\n\nCongratulations @${prAuthor}! Your merged PR has been rewarded.\n\n| Field | Value |\n|-------|-------|\n| **Recipient** | \`${recipient}\` |\n| **Amount** | **${amountSent} RTC** |${txLine}\n\n*Powered by [rtc-reward-action](https://github.com/Ivan-LB/rtc-reward-action)*`;

  const res = await request(
    'POST',
    `https://api.github.com/repos/${repoOwner}/${repoName}/issues/${prNumber}/comments`,
    { body: comment },
    { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
  );
  if (res.status === 201) {
    info(`PR comment posted successfully`);
  } else {
    warn(`Failed to post PR comment: ${res.status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  info(`RTC Reward Action — PR #${prNumber} by @${prAuthor}`);
  info(`Title: ${prTitle}`);

  if (!walletFrom) { error('wallet-from is required'); process.exit(1); }
  if (!adminKey)   { error('admin-key is required');   process.exit(1); }
  if (!nodeUrl)    { error('node-url is required');    process.exit(1); }
  if (isNaN(amount) || amount <= 0) { error(`Invalid amount: ${amount}`); process.exit(1); }

  const recipient = resolveRecipient(prBody, walletField, prAuthor);
  if (!recipient) {
    error('Could not determine recipient wallet. Add "RTC Wallet: <name>" to your PR body or a .rtc-wallet file.');
    process.exit(1);
  }

  info(`Rewarding: ${recipient} ← ${amount} RTC from ${walletFrom}`);
  info(`Node: ${nodeUrl}`);

  if (dryRun) {
    warn('DRY RUN — no transaction will be sent');
    info(`[DRY RUN] Would send ${amount} RTC to ${recipient}`);
    setOutput('tx-id', '');
    setOutput('recipient', recipient);
    setOutput('amount-sent', String(amount));
    info('Dry run complete.');
    return;
  }

  const payload = {
    from:      walletFrom,
    to:        recipient,
    amount,
    admin_key: adminKey,
    memo:      `PR #${prNumber} merged — automated RTC reward`,
  };

  let res;
  try {
    res = await request('POST', `${nodeUrl.replace(/\/$/, '')}/api/transfer`, payload);
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
    await postPRComment(txId, recipient, amount);
  } else {
    error(`Node returned ${res.status}: ${JSON.stringify(res.body)}`);
    process.exit(1);
  }
}

run().catch(e => { error(e.message); process.exit(1); });
