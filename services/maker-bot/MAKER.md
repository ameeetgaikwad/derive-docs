# Running a Hedge market maker

The maker-bot is the reference market-making client for Hedge. It connects to
the rfq-engine's maker WebSocket, prices incoming covered-call RFQs with
Black-76 off a live vol surface, and responds with EIP-712-signed quotes. When
your quote wins, the engine settles the trade on-chain via
`Matching.verifyAndMatch`.

You run this on your own infra, with your own key. The protocol never holds
your strategy or your key. This container is a starting point — fork the
pricing/hedging to suit your book.

See `docs/market-maker-integration.md` for the full wire protocol and signing
spec.

## What the bot does

- Buys the calls that retail users sell (covered calls), pricing at
  `MAKER_BID_RATIO × theo` (default 95% of Black-76 fair value).
- Vol input: with `DERIBIT_VOL=true` it fits an SVI curve to Deribit's live
  BTC mark-IV surface per expiry and reads vol at the requested strike
  (falling back to the on-chain vol feed if Deribit is unreachable). Forward
  and rate come from the on-chain feeds.
- Fully collateralized: buying a call only requires enough USDT cash in your
  subaccount for the premium + OI fee. `--setup` deposits it.

## Quick start (testnet, ~5 min)

From the repository root:

```sh
# 1. one-time: create the maker subaccount and deposit USDT collateral
CHAIN_ID=97 \
RPC_URL=https://bsc-testnet.bnbchain.org \
RFQ_ENGINE_WS=ws://127.0.0.1:3030/maker \
PRIVATE_KEY=0x<your-maker-key> \
DEPOSIT_USDT=100000 \
docker compose -f services/maker-bot/docker-compose.yml run --rm maker-bot --setup

# 2. run the quoting bot
CHAIN_ID=97 \
RPC_URL=https://bsc-testnet.bnbchain.org \
RFQ_ENGINE_WS=ws://127.0.0.1:3030/maker \
PRIVATE_KEY=0x<your-maker-key> \
docker compose -f services/maker-bot/docker-compose.yml up --build
```

Or without compose:

```sh
docker build -f services/maker-bot/Dockerfile -t hedge-maker-bot .
docker run --rm \
  -e CHAIN_ID=97 -e RPC_URL=https://bsc-testnet.bnbchain.org \
  -e RFQ_ENGINE_WS=ws://127.0.0.1:3030/maker \
  -e PRIVATE_KEY=0x<your-maker-key> \
  -e DERIBIT_VOL=true \
  hedge-maker-bot            # append --setup for the one-time subaccount step
```

The image is built from the repository root so it can use the root pnpm
workspace and committed protocol deployment address books. The compose file
and commands above use that context.

## Environment

| Var | Required | Default | Meaning |
|---|---|---|---|
| `CHAIN_ID` | yes | `97` | 56 mainnet / 97 testnet |
| `RPC_URL` | yes | — | BSC RPC endpoint |
| `RFQ_ENGINE_WS` | yes | `ws://127.0.0.1:3030/maker` | rfq-engine maker channel — use `wss://` in production |
| `PRIVATE_KEY` | yes | — | maker EOA key that signs quotes |
| `MAKER_SUBACCOUNT_ID` | — | from state file | your Matching subaccount (set after `--setup`) |
| `DEPOSIT_USDT` | — | `100000` | USDT to deposit during `--setup` |
| `MAKER_BID_RATIO` | — | `0.95` | bid as a fraction of theo when buying |
| `MAKER_ASK_RATIO` | — | `1.05` | ask as a fraction of theo when selling |
| `DERIBIT_VOL` | — | `true` (compose) | price vol off Deribit's live surface |
| `MAKER_MAX_FEE` | — | `0` | max matching fee the maker signs for (18dp) |
| `QUOTE_TTL_SEC` | — | `300` | signed-quote validity |
| `MAKER_STATE_FILE` | — | `maker-state.<chain>.json` | where the subaccount id is persisted |

## Production notes

- **Allowlist**: the rfq-engine can restrict makers by address
  (`MAKER_ALLOWLIST`). Give the operator the address of your `PRIVATE_KEY` to
  be admitted.
- **Endpoint**: connect over `wss://` through the operator's TLS endpoint, not
  the loopback dev URL.
- **Key management**: this reference bot reads a raw `PRIVATE_KEY`. For
  production, sign from an HSM/KMS — the signing surface is a single EIP-712
  quote message (see the integration doc); `@hedge/shared` ships a KMS-backed
  viem account you can adapt.
- **Hedging**: this bot holds the bought calls unhedged. A real desk hedges
  delta (e.g. on Deribit/Binance perps) — add that in your fork; it's your
  edge, and outside the protocol.
- **Image size**: the runtime image keeps dev dependencies for simplicity;
  prune with a production install if you need it smaller.
