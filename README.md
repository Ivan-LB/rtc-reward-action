# RTC Reward Action

Automatically award RTC tokens to contributors when their PR is merged on a RustChain-powered repository.

## Usage

```yaml
name: Reward Contributor
on:
  pull_request:
    types: [closed]

jobs:
  reward:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: Ivan-LB/rtc-reward-action@v1
        with:
          node-url:    ${{ secrets.RTC_NODE_URL }}
          wallet-from: ${{ secrets.RTC_WALLET_FROM }}
          admin-key:   ${{ secrets.RTC_ADMIN_KEY }}
          amount:      '5'
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `node-url` | ✅ | `https://50.28.86.131` | RustChain node URL |
| `amount` | | `5` | RTC tokens to award per merged PR |
| `wallet-from` | ✅ | | Sender wallet name (must exist on the node) |
| `admin-key` | ✅ | | Admin private key for signing the reward transaction |
| `dry-run` | | `false` | Set to `"true"` to simulate without sending real RTC |
| `wallet-field` | | `RTC Wallet:` | PR body field used to extract the recipient wallet |

## Outputs

| Output | Description |
|--------|-------------|
| `tx-id` | Transaction ID of the reward payment |
| `recipient` | Wallet address that received the reward |
| `amount-sent` | Actual RTC amount sent |

## Wallet Resolution

The action looks for a line in the PR body matching the `wallet-field` label:

```
RTC Wallet: alice_wallet
```

If no wallet line is found, it falls back to the PR author's GitHub username.

## Dry Run

Set `dry-run: 'true'` to test the action without sending real RTC:

```yaml
- uses: Ivan-LB/rtc-reward-action@v1
  with:
    node-url:    ${{ secrets.RTC_NODE_URL }}
    wallet-from: treasury
    admin-key:   ${{ secrets.RTC_ADMIN_KEY }}
    dry-run:     'true'
```

## License

MIT
