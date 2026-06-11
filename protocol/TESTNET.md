# BSC Testnet deployment (chainId 97)

Deployed 2026-06-11. All addresses in [`deployments/97.json`](deployments/97.json).

| Contract | Address |
|---|---|
| Matching | `0x0A98363B7679BE75682D579C4d8cc5D7b6F5a285` |
| RfqModule | `0x2769E33b2169C83304cEa0c5C8fbC5a1707E305D` |
| SubAccounts | `0x99cE5Aa19B39a023A62cD70fe68712825Ad8cAD0` |
| StandardManager (SRM) | `0x4d55A929e184fc366664C11526E3B54aB70340B5` |
| CashAsset (USDT) | `0x5d9e4EbD7E28deEF6f9A1a89Ed7Ce8608EE9074F` |
| BTC OptionAsset | `0xD0dD8DcA596540F615e66E07F49d40647D8bC6eD` |
| BTCB base asset | `0xc17EbE645aca587d7D2077097D797133FE2a633e` |
| Mock BTCB (18 dec, open mint) | `0x32fCF6a260Cdd2A3dc79cD0d4aD6B6c46bF6798A` |
| Mock USDT (18 dec, open mint) | `0x9896AF08d261E52a629EF58cBebd32E8e0AA8eA9` |

- EIP-712 domain separator: `0x4cc5ab9a5a9e3993fe20da61e691a365b4b67a1339557e5b0437ba83097c84b5` (verified on-chain)
- Feed signer: `0xdE50B8E965aD2B8E25f45a19FD87A2d2c737782F` (1-of-1, testnet only)
- Trade executor / deployer / feed poster: `0x6e154BEA64a1808dbAD715d87226e104Ad1EE9eB`
- RPC: `https://bsc-testnet.bnbchain.org` or thirdweb (key required); explorer: https://testnet.bscscan.com

Test tokens: `MockERC20.mint(address,uint256)` is **unrestricted** on both mocks — mint yourself
BTCB/USDT freely. Testnet-only convenience; real BTCB/USDT on mainnet.

To run the services against testnet, set in each service env:
`CHAIN_ID=97`, `RPC_URL=<rpc>`, `DEPLOYMENTS_PATH=protocol/deployments/97.json`, plus the
relevant keys (executor for rfq-engine, signer for oracle-feeds). See each service README.

Known testnet quirks:
- BSC testnet nodes mishandle EIP-1559 fee fields from forge — always broadcast with
  `--legacy --with-gas-price 200000000` (0.2 gwei).
- Public RPCs are flaky; prefer the thirdweb endpoint with `--retries 12 --delay 5`.
