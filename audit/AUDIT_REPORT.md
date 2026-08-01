# Saylis — Security Audit Report

**Scope:** all deployed Solidity contracts + the frontend/API surface that constructs and authorizes transactions
**Commit reviewed:** `163da8b` (branch `main`)
**Chain:** Arbitrum Sepolia (testnet)
**Date:** 2026-08-01

---

## 1. Scope

### In scope — on-chain (3,245 LoC)

| Contract | LoC | Role |
|---|---|---|
| `BondingCurve.sol` | 1,149 | Virtual-reserve x*y=k curve, fee split, whale sell tax, graduation |
| `InfoFiCampaign.sol` | 787 | Campaign pools, merkle-settled claims, TWAP eligibility |
| `GraduationMigrator.sol` | 305 | Curve → Uniswap V3 migration, LP burn |
| `TaxableLaunchToken.sol` | 297 | ERC-20 with post-graduation transfer-hook sell tax |
| `TokenFeeCollector.sol` | 150 | Converts collected tax to ETH, splits creator/protocol |
| `ReferralVault.sol` | 108 | Referral registry + unified pull-payment balances |
| `ImmutableLaunchToken.sol` | 101 | Minimal fixed-supply ERC-20 |
| `ProtocolTreasury.sol` | 64 | Owner-withdrawable fee sink |
| `libraries/`, `interfaces/` | 284 | TickMath, vendored interfaces |

### In scope — off-chain

All 27 API routes under `app/api/`, the wallet-signing and transaction-construction paths (`useLaunchToken`, `useReferral`, `ClaimPanel`, `ProfileMenu`, `app/admin/page.tsx`), address validation, and URL/HTML injection sinks.

### Out of scope

Uniswap V3 core/periphery, OpenZeppelin libraries, Chainlink feed operation, Supabase RLS policy correctness, and the economic design itself (bonding-curve parameters, fee percentages, tier thresholds).

### Methodology

Manual line-by-line review of every contract and route against: reentrancy (single-function, cross-function, read-only), access control, integer overflow/underflow and precision loss, oracle manipulation and staleness, front-running/MEV, unchecked external calls and return values, pull-payment correctness and solvency, CEI ordering, and DoS/griefing. Findings were verified against the compiled artifacts (`forge build`, exit 0) and the existing Foundry test suite.

---

## 2. Summary of findings

| ID | Severity | Title | Status |
|---|---|---|---|
| C-01 | **Critical** | Complete authentication bypass on every admin API route | **Fixed** |
| H-01 | **High** | Permissionless `distribute()` allows sandwiching all collected fees | **Fixed** |
| H-02 | **High** | Migration into a pre-created pool mints at an attacker-chosen price | **Fixed** |
| H-03 | **High** | User-identity spoofing across all non-admin API routes | **Fixed** on value-bearing routes; 4 low-harm routes deliberately left unsigned (see §4) |
| M-01 | Medium | Whale sells into the V3 pool revert (fee-on-transfer incompatibility) | **Fixed** |
| M-02 | Medium | `registerExternalPool` front-running on the transfer-then-register pattern | **Open** — see R-4 |
| M-03 | Medium | Graduation bonus is credited without backing ETH | **Acknowledged** — bounded by existing cap; see R-5 |
| M-04 | Medium | Unvalidated Chainlink round completeness | **Fixed** |
| M-05 | Medium | Division-by-zero / out-of-range tick bricks campaign poking | **Fixed** |
| L-01 | Low | Residual ETH stranded in `BondingCurve` after migration | **Acknowledged** |
| L-02 | Low | `setAmmPair` failure silently swallowed, disarming the tax | **Open** |
| L-03 | Low | Unauthenticated image upload to a metered third-party API | **Open** |
| L-04 | Low | Nonce prediction uses `latest` rather than `pending` | **Acknowledged** — fails safe |
| I-01 | Info | `campaign.owner` written but never read | — |
| I-02 | Info | Non-constant-time `CRON_SECRET` comparison | — |

**Verified sound (no finding):** reentrancy protection across all value-moving paths; the `creatorFee + protocolFee == feeAmount` wei-exact invariant; sell-side reserve accounting; merkle claim replay protection (double-hashed leaves + `hasClaimed`); the one-way `graduated` / `migrationExecuted` / `migrated` latches; `ImmutableLaunchToken` and `ProtocolTreasury` in full; `resolveSocialUrl`'s `javascript:` filtering; the `dangerouslySetInnerHTML` sink (static constant lookup only).

---

## 3. Critical

### C-01 — Complete authentication bypass on every admin API route

**Files:** `app/api/admin/**/route.ts` (7 routes)

Every admin route determined its caller by reading a `walletAddress` field straight out of the request body or query string and comparing it to `INFOFI_TEAM_ADDRESS`:

```ts
const caller = body.walletAddress?.toLowerCase() ?? "";
if (caller !== INFOFI_TEAM_ADDRESS.toLowerCase()) {
  return NextResponse.json({ error: "Not authorized." }, { status: 403 });
}
```

`isAddress()` was applied elsewhere, which checks that a string is *shaped* like an address — it proves nothing about control of the corresponding key. There was **no signature verification anywhere in the codebase** (confirmed: zero occurrences of `verifyMessage`, `recoverAddress`, SIWE, session cookies, or JWT across `app/api` and `app/_lib`).

The gate was therefore a string comparison against a value the attacker supplies. A single unauthenticated request grants full admin capability:

```bash
curl -X POST https://<host>/api/admin/notifications/broadcast \
  -H 'Content-Type: application/json' \
  -d '{"walletAddress":"<team address, public on-chain>","title":"...","message":"..."}'
```

**Impact.** Push arbitrary notifications to every registered wallet (a ready-made phishing channel carrying the protocol's own branding); approve or reject any campaign request; mint Path B invites for attacker-controlled wallets; forge lock/burn confirmations, desynchronising the Supabase mirror from chain state. The team address is not secret — it is an immutable public constant in `config.ts` and visible in every on-chain interaction.

This does **not** grant on-chain authority: `InfoFiCampaign.openCampaign` / `publishResults` are `onlyTeam` against a real multisig, and no server-side key exists for it (correctly — see §6). The compromise is total over the off-chain approval workflow and the notification system.

**Fix applied.** Added `app/_lib/walletAuth.ts` (server) and `app/_lib/useWalletAuth.ts` (client), implementing per-action `personal_sign` verification. The client signs a structured, expiring message; the server rebuilds it with the *same shared function* and recovers the signer with viem's `verifyMessage`. Authorization is now performed against the **recovered** address, never the body's stated one.

The signed message binds four things, each closing a specific replay path:

- `domain` — a signature harvested by another site cannot be replayed here.
- `action` — an "approve a campaign" signature is not also a "broadcast to every user" signature.
- `address` — what the user sees in the wallet prompt matches what the server checks.
- `issuedAt` — bounded to ±5 minutes, so a leaked signature expires (future-dated timestamps are rejected too, which would otherwise extend the window arbitrarily).

All seven routes were converted, including the read-only queue route (`GET /api/admin/campaigns`), which exposes the team's private review pipeline and every owner wallet behind it. `app/admin/page.tsx` was updated at all seven call sites.

Deliberately *not* a session/cookie scheme: sessions need server-side storage and revocation to be safe, a per-action signature needs neither, and these actions are infrequent enough that signing each one is not a usability cost.

---

## 4. High

### H-01 — Permissionless `distribute()` allows sandwiching all collected fees

**File:** `contracts/src/TokenFeeCollector.sol`

`distribute()` swaps the entire collected tax balance through Uniswap with a **caller-supplied** `amountOutMinimum`, and was callable by anyone. The NatSpec warned that "passing 0 invites a sandwich" — but since the caller chooses both the trigger *and* the slippage bound, an attacker simply calls `distribute(0)` inside their own sandwich and extracts nearly the entire balance. No honest caller could prevent it; the warning was unenforceable by construction.

**Impact.** Complete theft of accrued post-graduation sell tax, repeatable every time the balance refills. Loss falls on the creator (85%) and the protocol (15%).

**Fix applied.** Restricted the trigger to `creator` and `protocolTreasury` — the only two parties the proceeds can ever reach:

```solidity
if (msg.sender != creator && msg.sender != protocolTreasury) revert NotAuthorized();
```

The one address able to set a bad bound is now an address that would only be robbing itself. Destination and split are unchanged and still fixed by the contract; this narrows *who may trigger*, never where the money goes.

### H-02 — Migration into a pre-created pool mints at an attacker-chosen price

**File:** `contracts/src/GraduationMigrator.sol`

`migrate()` calls `createAndInitializePoolIfNecessary(...)`, which is a **no-op against a pool that already exists** — it does not re-initialize the price. Anyone may create the token/WETH pool at the target fee tier before `migrate` runs, at an arbitrary `sqrtPriceX96`. The subsequent full-range `mint` then executes at the attacker's price with `amount0Min: 0, amount1Min: 0`, consuming only a sliver of one side.

Compounding this: the migrator has **no owner, no rescue function, and no other method that can move a balance**. Everything the mint failed to deposit was stranded permanently and silently.

**Impact.** An attacker pre-creates the pool at a price far from fair value, the migration seeds liquidity there, and the attacker arbitrages the mispricing against the graduated token's entire migrated liquidity. Separately, the undeposited remainder — potentially most of the curve's raised ETH and reserved 20% supply — was destroyed.

**Fix applied.** Two parts.

*Refuse to seed a hijacked pool.* After `createAndInitializePoolIfNecessary`, `migrate` reads `slot0` and requires the pool's price to be within `PRICE_TOLERANCE_BPS` (1%) of the value it just derived from the curve's real reserves. On a pool `migrate` itself creates, the two are identical, so any real gap means the pair pre-existed. Reverting unwinds the whole migration atomically — including `withdrawForMigration` — leaving everything retryable rather than half-done.

*Make that guard non-blocking.* A bare tolerance check would hand the attacker a better weapon: permanently brick migration by squatting the pool, stranding the curve's ETH forever. So `alignPoolPrice(curve)` is added — permissionless, and safe to be, because it only ever moves price toward a target this contract independently derives from the curve's own reserves; the caller supplies nothing but gas and cannot influence the destination.

It is restricted to pools with **zero liquidity**, which is exactly the griefing case (creating and initialising a pool is nearly free; funding one at a bad price is not). With no liquidity to cross, V3 walks the price straight to the limit and settles nothing, so the correction costs only gas and `uniswapV3SwapCallback` is owed nothing — it reverts with `UnexpectedSwapDebt` if a swap ever asks this contract to pay, since that would mean the callback was reached some other way. A pool someone has genuinely funded is a real market that ordinary arbitrage corrects; this contract has no business moving it with assets it does not own.

Net effect: a squatter can delay a migration by one transaction, which anyone can clear, and can no longer capture it.

*Leftovers.* Separately, leftovers are now swept rather than stranded, and unconsumed approvals are cleared:

```solidity
IERC20(token0).forceApprove(address(positionManager), 0);
IERC20(token1).forceApprove(address(positionManager), 0);
_sweepLeftovers(tokenAddr, curve.protocolTreasury());
```

Leftover launch tokens follow the LP position to the burn address (they are supply that was never sold and is now unbacked); unspent ETH is unwrapped and returned to the curve's own protocol treasury, best-effort so a rejecting treasury cannot unwind an otherwise-complete migration. On the intended path — a freshly created pool priced from these exact amounts — the remainder is rounding dust, so this is a no-op in the normal case.

### H-03 — User-identity spoofing across all non-admin API routes

**Files:** `app/api/infofi/join`, `campaigns/request`, `notifications/read`, `referral/ensure`, `referral/[wallet]`, `x/verify/confirm`, `campaigns/mine`, `wallets/register`, `chat/send`

The same pattern as C-01, at user privilege: every route takes the acting wallet from `body.walletAddress` or `?wallet=` and validates only its *format*.

**Impact.** Join an InfoFi campaign as another wallet (polluting the mindshare leaderboard that determines token payouts); mark another user's notifications read; claim or bind a referral code for a wallet you do not control; bind your X account to someone else's wallet via `x/verify/confirm`; enumerate another wallet's private campaign list via `campaigns/mine`. Chat is already partly mitigated — the 30s cooldown is enforced server-side against `chat_cooldowns` — but the *sender identity* on a message is still spoofable.

**Fix applied, selectively — and the selection is the interesting part.**

`verifyWalletAuth` was applied to every route where spoofing reaches something that matters, together with its client caller:

| Route | Action | Why it must be proven |
|---|---|---|
| `infofi/join` | `infofi:join` | Feeds the mindshare set that produces the merkle root real tokens are claimed against |
| `x/verify/start` + `confirm` | `x:verify-*` | Binds an X handle to a wallet, deciding who mindshare is credited to |
| `campaigns/request` | `campaigns:request` | Attributed to a wallet and surfaced to the team as that wallet's request |
| `campaigns/[token]/configure` | `campaigns:configure` | Gated on `owner_wallet`, so the identity feeding that check must be real |
| `campaigns/[token]/lock` | `campaigns:lock` | Same |

Four routes were **deliberately left unsigned**, and each carries a comment saying so and why. Signing them would mean a wallet prompt fired by arrival rather than by any decision the user made — `wallets/register` and `referral/ensure` run automatically on connect, `campaigns/mine` on every `/campaigns` page load, `notifications/read` on opening the bell. That is not merely annoying; it is counterproductive, because it trains users to dismiss signing prompts and the prompts that matter are the ones on routes that move value.

The trade is defensible only because none of the four grants anything:

- `wallets/register` — a row of address + first-seen. No authority, no funds, no visibility. Residual risk is padding the broadcast audience, a capacity problem addressed by rate limiting (R-6), not a privilege one.
- `referral/ensure` — the code is a public lookup key pointing *at* a wallet. Earnings live on-chain in `ReferralVault`, and `withdrawReferralFees` pays `msg.sender`, so minting someone else's code cannot yield a wei of it.
- `notifications/read` — clears an unread badge. Moves nothing, reveals nothing.
- `campaigns/mine` — read-only and address-scoped; exposes one wallet's own campaign list, not the review pipeline the admin queue exposes.

If `campaigns/mine` should become genuinely private, the right fix is a short-lived session (sign once on connect, reuse for reads), not a per-request signature — see R-2.

---

## 5. Medium

### M-01 — Whale sells into the V3 pool revert (fee-on-transfer incompatibility)

**File:** `contracts/src/TaxableLaunchToken.sol`

`_update` deducts tax from `value` on transfers into `ammPair`, making the token fee-on-transfer on sells. Uniswap V3's `swap()` asserts it received exactly what it requested:

```solidity
require(balance0Before.add(uint256(amount0)) <= balance0(), 'IIA');
```

A taxed (whale) sell delivers less than that and reverts.

**Impact.** Not a fund loss — an availability and revenue bug. Whale sells through any standard V3 router fail outright; the post-graduation tax the contract exists to collect is never collected on the pool leg. Non-whale sells are unaffected (`tax == 0` leaves `value` untouched). The severity depends on how often holders actually exceed the live tier threshold.

**Fix applied.** The tax is now charged **on top of** the transferred amount rather than skimmed out of it, so the pool always receives exactly what it asked for and the token is no longer fee-on-transfer:

```solidity
uint256 headroom = balance > value ? balance - value : 0;
if (tax > headroom) tax = headroom;
if (tax > 0) {
    super._update(from, feeCollector, tax);   // value is NOT reduced
    emit SellTaxCollected(from, tax);
}
```

The seller pays `value + tax` in total. V3's `IIA` assertion is satisfied, so whale sells go through and the tax actually collects — both halves of the bug close together.

The cap matters: a whale selling their *entire* balance has no headroom left to pay from, so the tax falls to zero rather than reverting. Blocking an exit in order to collect a fee is never the right trade, and it is the same "a user must always be able to exit their position" guarantee `BondingCurve` already makes explicit. `quoteSellTax` mirrors the cap exactly so a quote never disagrees with the transfer.

### M-02 — `registerExternalPool` front-running

**File:** `contracts/src/InfoFiCampaign.sol`

Registration uses a two-step transfer-then-register pattern and believes the contract's balance rather than an argument. Between a funder's transfer and their `registerExternalPool` call, anyone may call it first and become `campaign.owner` using the funder's tokens — registering with `curve = address(0)` (permanently forfeiting automatic eligibility) or with a token `amount` that strands the remainder.

`registerAllocation` is **not** affected: it is called from `BondingCurve`'s constructor in the same transaction, so no window exists.

**Impact.** Griefing, not theft — `campaign.owner` is written but never read for authorization (see I-01), and payouts still require the team to open the campaign. The funder's tokens can be locked into a misconfigured campaign they cannot correct.

**Status: open**, see R-4.

### M-03 — Graduation bonus credited without backing ETH

**File:** `contracts/src/BondingCurve.sol`, `_maybeGraduate`

Trading keeps `address(this).balance == realEthReserve + creatorFeesOwed + protocolFeesOwed` exact to the wei. `_maybeGraduate` then does `creatorFeesOwed += bonus` with no matching inflow, leaving the contract nominally insolvent by `graduationThreshold * 2.5%`.

This is contained, and knowingly so: `withdrawForMigration` caps its payout at what the contract can actually spare once owed fees are set aside, so `withdrawCreatorFees`/`withdrawProtocolFees` always pay in full. The shortfall is therefore borne by *migrated liquidity*, not by fee recipients.

**Status: acknowledged.** Correct as a safety property; the economic consequence (graduation reduces seeded liquidity by 2.5% of the threshold) is a design choice, flagged in R-5 rather than changed.

### M-04 — Unvalidated Chainlink round completeness — **Fixed**

**Files:** `BondingCurve.sol`, `TaxableLaunchToken.sol`, `InfoFiCampaign.sol`

All three consumers checked `answer > 0` and `updatedAt` staleness but ignored `roundId`/`answeredInRound`, so an answer carried over from a previous round, or a round that never completed (`updatedAt == 0`), was accepted as fresh.

**Fix applied** in all three, matching each site's existing graceful-degradation contract (never revert; fall back to the most lenient tier / report "cannot tell"):

```solidity
if (updatedAt == 0 || answeredInRound < roundId) return (0, false);
```

### M-05 — Division-by-zero and out-of-range tick brick campaign poking — **Fixed**

**File:** `contracts/src/InfoFiCampaign.sol`, `_poolMarketCapUsd`

Every failure mode in this function degrades to `(0, false)` so `recordMarketCap` stays callable — except two that reverted instead:

1. `Math.mulDiv(1 << 96, ..., priceX96)` divides by zero when the squared price rounds to zero at the extreme low end of the tick range.
2. `TickMath.getSqrtRatioAtTick(avgTick)` reverts outside Uniswap's global bounds.

A revert propagates out of `marketCapUsd` into `recordMarketCap`, making the token permanently un-pokeable and blocking eligibility.

**Fix applied:** both now return `(0, false)`, consistent with every other path in the function.

---

## 6. Low / Informational

- **L-01** — `withdrawForMigration` sets `realEthReserve = 0` even when `ethAmount` was capped below it (M-03). The difference remains in the contract, attributable to nobody. Small and bounded by the bonus.
- **L-02** — `GraduationMigrator._wirePostGraduationFees` wraps `setAmmPair` in `try/catch {}` to tolerate legacy non-taxable tokens. A genuine failure on a taxable token is swallowed identically, silently disarming the sell tax forever (`setAmmPair` is one-shot). Recommend distinguishing the two, e.g. probing `sellTaxBps()` first.
- **L-03** — `POST /api/upload-image` is unauthenticated and forwards to Pinata using a server-held `PINATA_JWT`. Type and size (`MAX_FILE_BYTES`) are validated, but nothing rate-limits it; an attacker can exhaust a metered quota. Recommend wallet-gating it (H-03's helper) or rate-limiting by IP.
- **L-04** — `useLaunchToken` predicts the curve address from `getTransactionCount` at the default `latest` block tag; a pending transaction invalidates the prediction. This **fails safe** — the curve constructor's `balanceOf(address(this)) > 0` check reverts rather than deploying a broken curve — but wastes the token deploy's gas. `pending` would be more robust.
- **I-01** — `Campaign.owner` is written by both registration paths and never read. Dead state; either remove or use it (it would give M-02 a natural fix).
- **I-02** — `CRON_SECRET` is compared with `===`. Timing attacks over HTTP against a high-entropy bearer token are impractical; noted for completeness.

**Positively verified.** The following were examined specifically and found correct: `nonReentrant` coverage on every ETH-moving function with effects-before-interactions ordering throughout; the pull-payment rationale (a hostile `creator` cannot revert-grief trading); permissionless withdrawals with immutable destinations; `_splitFee`'s remainder arithmetic (no rounding dust); sell-side reserve accounting balancing exactly against the gross/net/tax/referral split; merkle claims (double-hashed leaves defeat second-preimage node replay, `hasClaimed` defeats proof replay, and `ClaimExceedsPool` caps a malformed root at the real pool size); the burn-address LP lock with no unlock path; `ImmutableLaunchToken` (no owner, mint, pause, blacklist, or proxy) and `ProtocolTreasury` in full; `resolveSocialUrl`'s scheme allowlist correctly rejecting `javascript:`; the sole `dangerouslySetInnerHTML` reading from a static constant map; and — notably — that `INFOFI_POKER_PRIVATE_KEY` holds only permissionless capability (`recordMarketCap`, `migrate`), with the team multisig key correctly absent from the codebase entirely.

---

## 7. Remaining recommendations

**R-1 (H-02) — Consider deterministic pool creation as a follow-up.** The tolerance check plus `alignPoolPrice` closes the vulnerability, but a squatter can still force one extra transaction before each migration. Having the curve or a factory create and initialize the pool at deployment removes the window entirely and makes `alignPoolPrice` dead code. Worth doing at the next redeploy; not urgent now that value cannot be captured.

**R-2 (H-03) — Add a session for the read paths.** Four routes were left unsigned to avoid prompting on page load (see §4). If `campaigns/mine` in particular should be private, add a short-lived signed session — sign once on connect, reuse for reads — rather than a per-request signature. `buildAuthMessage` already produces a suitable message; it needs a server-side token exchange and expiry.

**R-3 (M-01) — Surface the tax in the sell UI.** Now that whale sells succeed, the seller pays `amount + tax` and needs the headroom for it. A sell sized to their exact full balance silently collects no tax (by design), but one sized just under it will spend more than the number shown. `quoteSellTax` exists for precisely this; wire it into the trade panel so the total is explicit before signing.

**R-4 (M-02) — Convert `registerExternalPool` to a pull.** `safeTransferFrom(msg.sender, address(this), amount)` removes the front-run window entirely. Requires the frontend to `approve` first instead of transferring. `registerAllocation` must keep the balance-evidence pattern (it runs mid-constructor, where the curve has no code to call back into — correctly documented in the contract).

**R-5 (M-03) — Confirm the graduation bonus should dilute migrated liquidity.** If not, fund it from accumulated fees rather than reserve, or exclude it from the migration cap.

**R-6 — General.** Add regression tests for each fix (particularly the oracle round-completeness paths and the migrator sweep); add rate limiting to unauthenticated public routes; and treat `answeredInRound`/`updatedAt` validation as the standard pattern for any future feed consumer.

---

## 8. Verification

- `forge build` — **exit 0**, no errors. Remaining output is pre-existing lint (`erc20-unchecked-transfer` in tests, `divide-before-multiply` on the intentional tick-spacing truncation in `GraduationMigrator`, which is documented and correct).
- `npx tsc --noEmit` — **clean**, no errors.
- `npm run build` — **exit 0**.
- `forge test` — **215 passed, 0 failed** across 10 suites.

Three test files needed updating, in each case because they asserted the behaviour that *was* the bug:

- `TokenFeeCollector.t.sol` (H-01) — 10 tests called `distribute()` from an arbitrary address. Nine were re-pranked as `creator`. The tenth, `test_Distribute_IsPermissionless`, asserted precisely the property that is the vulnerability, so it was replaced by `test_RevertWhen_DistributeCalledByStranger` (a stranger reverts; the tax stays untouched and claimable) and `test_Distribute_AllowedForCreatorAndTreasury` (both permitted callers work, neither profits).
- `TaxableLaunchToken.t.sol` (M-01) — `test_WhaleSellIsTaxed` asserted the pool received `amount - tax`, i.e. the fee-on-transfer behaviour V3 rejects. It now asserts the pool receives the full `amount` and the seller pays `amount + tax`. `testFuzz_TaxNeverExceedsConfiguredRate` had its conservation invariant restated the same way. Added `test_WhaleSellingEntireBalanceIsNotBlocked` to pin the headroom cap.
- `mocks/MockUniswapV3Pool.sol` — extended with `liquidity()` and `swap()` to match the widened `IUniswapV3Pool` interface, mirroring the one V3 behaviour relied on (an empty pool's price walks to the limit, settling nothing).

**`GraduationMigrator` fork suite — 9 of 10 passing.** This suite forks Arbitrum Sepolia over the shared public RPC, which rate-limits (HTTP 429) under the request volume a fork test generates. On a later re-run 9 tests passed, including `test_Migrate_EndToEnd_CreatesPoolMintsAndBurnsLp` — so the H-02 changes do execute correctly against a real fork, not merely compile.

The one remaining failure is `testFuzz_Migrate_AcrossReserveSizes`, and it fails inside `vm.deal` during setup with a 429 — before any contract logic runs. A fuzz test multiplies RPC calls by its run count, so it trips the public endpoint's limit first. This is environmental, not a defect signal.

Two gaps remain, and both need a dedicated RPC (set `ARBITRUM_SEPOLIA_RPC_URL`; note the repo's `.env.local` currently leaves `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` empty, so both app and tests fall back to the public endpoint):

1. Get `testFuzz_Migrate_AcrossReserveSizes` green.
2. **No test yet covers the new H-02 logic specifically.** The existing suite proves migration still works end to end, which is what regression coverage should do — but the paths that close the vulnerability are untested. Add: a squatted pool making `migrate` revert with `PoolPriceOutOfRange`, `alignPoolPrice` clearing it, `migrate` then succeeding, and `PoolAlreadyFunded` on a funded pool. Until those exist, H-02's fix is verified only by inspection.

Fee percentages, tier tables, splits and thresholds are untouched. Four intentional behavioural changes, each of which *is* the fix rather than a side effect of it:

- **C-01 / H-03** — protected routes now require a signature.
- **H-01** — `distribute` is caller-restricted.
- **H-02** — `migrate` refuses a mispriced pre-existing pool, with `alignPoolPrice` as the permissionless escape hatch.
- **M-01** — the whale sell tax is charged on top of the transfer instead of skimmed from it. Note this is a real economic change in *incidence*: previously the buyer-side pool absorbed the shortfall (or, in practice, the trade simply reverted); now the seller pays it explicitly. The rate is unchanged, and this is the only way to charge it at all against a V3 pool.

---

## 9. Changed files

**Contracts**
- `BondingCurve.sol` — Chainlink round-completeness validation (M-04)
- `TaxableLaunchToken.sol` — round-completeness validation (M-04); tax charged on top of the transfer with a headroom cap, `quoteSellTax` mirrored (M-01)
- `InfoFiCampaign.sol` — round-completeness validation (M-04); zero-price and out-of-range-tick guards (M-05)
- `TokenFeeCollector.sol` — `distribute` restricted to creator/treasury, `NotAuthorized` added (H-01)
- `GraduationMigrator.sol` — pool-price tolerance check, `alignPoolPrice`, `uniswapV3SwapCallback`, approval cleanup, `_sweepLeftovers` (H-02)
- `interfaces/IUniswapV3Pool.sol` — added `liquidity()` and `swap()` (H-02)

**Off-chain**
- `app/_lib/walletAuth.ts` — **new**, server-side signature verification
- `app/_lib/useWalletAuth.ts` — **new**, client-side signing hook
- `app/api/admin/**` (7 routes) — signature-verified authorization (C-01)
- `app/api/infofi/join`, `campaigns/request`, `campaigns/[token]/{configure,lock}`, `x/verify/{start,confirm}` — signature-verified authorization (H-03)
- `app/api/{wallets/register, referral/ensure, notifications/read, campaigns/mine}` — documented as deliberately unsigned, with the reasoning inline (H-03)
- `app/admin/page.tsx`, `app/_components/ConnectXModal.tsx`, `app/_components/campaigns/{JoinPanel,CampaignCard,SendSupplyModal}.tsx` — call sites updated to sign

**Tests**
- `contracts/test/TokenFeeCollector.t.sol` — updated for the H-01 caller restriction
- `contracts/test/TaxableLaunchToken.t.sol` — updated for the M-01 incidence change, plus full-exit coverage
- `contracts/test/mocks/MockUniswapV3Pool.sol` — extended for the widened pool interface
