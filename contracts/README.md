# loxley.wtf — Launch Token Contracts

A minimal, fully immutable ERC-20 for the launchpad factory, built with
[Foundry](https://book.getfoundry.sh/) on top of OpenZeppelin's audited
`ERC20` base. Targets Arbitrum Sepolia; the same artifact deploys unmodified
to Robinhood Chain (an Arbitrum Orbit L2, EVM/bytecode-identical to Arbitrum
Sepolia) — only the RPC endpoint changes.

This folder is self-contained and does **not** affect the Next.js frontend
at the repo root.

## Contract

`src/ImmutableLaunchToken.sol` — see the extensive NatSpec at the top of the
file for the full rationale behind every omitted "admin" feature (no owner,
no mint function, no admin burn, no pause, no blacklist, no upgradeability).
In short: total supply is minted exactly once, in the constructor, entirely
to a `curve` address supplied at deployment — never to `msg.sender`.

## Setup

```bash
cd contracts
forge install          # pulls forge-std + openzeppelin-contracts (already vendored in lib/)
cp .env.example .env   # fill in PRIVATE_KEY, BONDING_CURVE_ADDRESS, token params
```

## Test

```bash
forge test -vv
```

29 tests cover: correct metadata/decimals, entire supply minted to the curve
address (never the deployer), standard transfer/approve/transferFrom
behavior + revert cases, an explicit gas-cost assertion on deployment, and
selector-probing tests that assert `owner()`, `mint()`, `burn()`, `pause()`,
`unpause()`, `blacklist()`, and `upgradeTo()` all fail to resolve — i.e. no
privileged function exists on the deployed bytecode at all, not merely "is
unreachable." Five `testFuzz_*` functions fuzz transfer edge cases (zero
address, self-transfer, insufficient balance, arbitrary recipient,
partial-allowance spends).

```bash
forge snapshot   # regenerate .gas-snapshot with exact gas figures
```

## Deploy — Arbitrum Sepolia

```bash
source .env
forge script script/DeployImmutableLaunchToken.s.sol:DeployImmutableLaunchToken \
  --rpc-url arbitrum_sepolia \
  --broadcast \
  --verify \
  -vvvv
```

Drop `--verify` (and `ARBISCAN_API_KEY`) if you don't need Arbiscan source
verification for this run.

### Deploying to Robinhood Chain instead

Robinhood Chain is chain-identical to Arbitrum Sepolia (same Arbitrum Orbit
stack). Reuse the exact same compiled artifact — just point `--rpc-url` at
Robinhood Chain's RPC endpoint instead of `arbitrum_sepolia`; no contract or
script changes are required.
