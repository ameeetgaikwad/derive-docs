# BSC mainnet staging configuration

This directory is isolated from the canonical chain-56 deployment. It is for
controlled public staging with real BNB Chain mainnet assets. It must remain
clearly labelled as staging and must not be represented as a production launch.

`DeployMainnetStaging.s.sol` wrote the generated deployment to `56.json`. The
tracked `markets/56.json` contains the verified BTC deployment, is enabled for
public staging, and keeps the maximum individual RFQ size at `0.01 BTC`.

Copy `rfq.env.example` outside the repository and replace every placeholder.
Run the RFQ engine with `TAKER_OPEN=true`, a non-empty `MAKER_ALLOWLIST`, a
durable store, and rate limiting. Taker authentication/allowlisting is not
implemented, so any wallet that can reach the public endpoint can request an
RFQ. Bind the process to `127.0.0.1` and expose it only through a monitored
HTTPS/WSS reverse proxy. Never expose the private RPC or signing credentials.

The mainnet-staging RFQ service uses port `3030` on its dedicated server. The
testnet RFQ service may also use `3030` on a different server. If both processes
share one host, change one port and its corresponding frontend endpoint.

The contract deployment itself enforces a `0.05 BTC` aggregate option-position
cap, a `0.05 BTCB` aggregate base-position cap, disabled cash borrowing, the
existing 0.1% OI fee, and an initial 10 USDT minimum OI fee. The staging
deployment has applied `ConfigureMainnetStagingFee.s.sol` to reduce only its
minimum OI fee to 0.01 USDT so minimal-value smoke trades exercise real fee
accounting. The percentage OI fee remains unchanged; this override must not be
copied to a production deployment.

A minimal-value real-BTCB trade has completed on this staging deployment. That
smoke test does not replace the outstanding ITM and OTM settlement rehearsals
required before a production launch.
