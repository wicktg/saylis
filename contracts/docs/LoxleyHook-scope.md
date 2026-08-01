# LoxleyHook.sol — Design Scope

Status: **scoping only. No implementation. Not audit-ready. Not for real funds.**

Replaces `BondingCurve.sol` + `GraduationMigrator.sol` with one Uniswap V4 hook
owning a single persistent pool per token, from launch through graduation and
indefinitely after.

---

## 0. Blockers — resolve before implementation

Four items in the brief are either self-contradictory or not achievable as
stated. Each needs an explicit decision.

### B1 — "Zero external calls in the swap path" vs. the live Chainlink oracle

The whale-tax tiers are denominated in **USD market cap**, which requires
`AggregatorV3Interface.latestRoundData()` — an external call — inside
`beforeSwap`. These requirements cannot both hold.

| Option | Trade-off |
|---|---|
| **A. Allow the oracle call**, keep it the *only* external call, `staticcall`, bounded gas, try/catch → fall back to the most conservative tier on failure | Keeps USD semantics identical to today. Weakens the "zero external calls" rule to "one pinned, non-reentrant, view-only call". |
| **B. Denominate tiers in ETH** (e.g. 50 / 100 / 167 / 333 ETH at $3k) | True zero external calls. Tier boundaries drift in USD terms as ETH moves — a behavioural change from the audited contract. |
| **C. Cache price, refresh out-of-band** | Zero calls in the hot path, but a staleness window is an attack surface, and the refresher is an admin-ish function, brushing against "no admin". |

**Recommendation: A.** The oracle is view-only and reentrancy-free; option B
silently changes economics that were already specified, tested, and reviewed in
USD terms.

### B2 — Max-wallet cap is not reliably enforceable in a V4 hook

`beforeSwap(address sender, ...)` gives the **caller of `PoolManager.swap`** —
i.e. the router — not the end recipient. Consequences:

- Every user swapping through the same router looks like one address.
- Checking `balanceOf(sender)` measures the router (usually ~0), so the cap
  passes trivially.
- `hookData` could carry a claimed recipient, but it is attacker-controlled and
  therefore worthless as a security control.

Today `BondingCurve.buy()` is called directly by the buyer, so `msg.sender` *is*
the wallet and the cap is sound. That property does not survive the move to V4.

Options: (a) enforce on the **token** via a transfer hook instead of the pool
hook; (b) restrict the pool to a canonical Loxley router that passes a verified
recipient and block all other callers — which reintroduces a privileged address;
(c) accept that the 2.5% cap becomes advisory post-V4 and document it.

**No option preserves today's guarantee.** This needs a product decision, not
just an engineering one.

### B3 — Graduation reshape forces a ~1.9× price discontinuity

Assets available at graduation vs. what a full-range position needs at the
graduation price:

```
ETH into LP        4.0950   (4.2 raised − 2.5% bonus)
TOKEN into LP    231.37 M   (31.37 M curve remainder + 200 M reserved)
P implied by ratio 5.650123e7  TOKEN/ETH   (tick 178507)
P at graduation    1.076509e8  TOKEN/ETH   (tick 184953)
gap                1.905×
```

A full-range position is balanced 50/50 by value, so the deposit ratio *defines*
the price. With only ~half the tokens needed to balance at `P_grad`, the pool
reprices ~1.9× upward the instant it graduates.

This is **not a regression** — the existing `GraduationMigrator` derives
`sqrtPriceX96` from the deposit ratio too, so live Pope behaved this way. But in
V4 it happens atomically inside a user's swap, so that swapper eats the jump.
Options: cap the reshape to a bounded range that matches the ratio; deposit only
the balanced portion and lock the remainder; or accept and document it.

### B4 — Hook address mining

V4 encodes hook permissions in the **address bits**, so the deployment address
must be CREATE2-mined for the exact permission set. One shared hook serving all
tokens (per-pool config in storage) is therefore mandatory — mining an address
per token is infeasible. This also means the permission set is frozen at deploy;
adding a callback later requires a new hook and new pools.

---

## 1. Why a single CL position reproduces the curve exactly

A Uniswap concentrated-liquidity position over `[Pa, Pb]` with liquidity `L`
*is* a constant-product AMM with virtual reserves:

```
(x_real + L/√Pb) · (y_real + L·√Pa) = L²
```

which is structurally identical to `BondingCurve`'s
`(realEth + virtualEth) · (realToken + virtualToken) = k`.

Mapping (V4 orders native ETH = `address(0)` as **currency0**, token as
**currency1**, so pool price `P = TOKEN per ETH`):

```
L/√Pb  = virtualEthReserve   = 6e18
L·√Pa  = virtualTokenReserve = 1.066666667e27
L      = √k = √((800M + 1.0667B)·6)  = 1.058300525e23
```

## 2. Deliverable 1 — exact tick range

```
Pa = 1.015873016e8  TOKEN/ETH   tick = 184373.51   ← all tokens sold, 4.5 ETH
Pb = 3.111111112e8  TOKEN/ETH   tick = 195566.38   ← launch, 800M token / 0 ETH
```

Verified against the position formulae:

| Check | Computed | Expected |
|---|---|---|
| TOKEN at `P = Pb` | 800.000 M | 800 M (80% of 1B) |
| ETH at `P = Pa` | 4.5000 | 4.5 |
| Sold at graduation | 768.63 M (96.1%) | 768.6 M / 96.1% per `config.ts` |
| `tokenReserve` at graduation | 1098.04 M | — |
| Graduation tick | 184953.29 | — |
| `sqrtPriceX96` at graduation | 8.220314e32 | — |

**Direction of travel:** the pool *starts at `tick_upper`* and moves **down**
as buyers arrive. Counterintuitive but correct: with ETH as currency0, price is
TOKEN-per-ETH, which falls as the token appreciates. Position is 100% currency1
at the upper bound, which is exactly the launch state (all token, no ETH).

**Tick alignment.** Neither bound lands on an integer. Ticks must be multiples
of `tickSpacing`, so:

1. Choose `tickSpacing = 1` (viable: the pool has one position and no other LPs,
   so no interior tick is ever crossed and the usual gas argument for wide
   spacing does not apply).
2. Round to `tick_lower = 184374`, `tick_upper = 195566`.
3. **Derive `L` from the actual 800M token deposit at those rounded ticks** —
   do *not* hardcode `L` from the ideal values. This absorbs rounding into `L`
   rather than into the token balance.

Resulting virtual reserves deviate from `(6 ETH, 1.0667B)` by <0.01%. Tests must
assert this bound explicitly (§3, U4).

## 3. Deliverable 2 — test plan

### Hook permissions required
`afterInitialize` (seed position, write immutable per-pool config), `beforeSwap`
+ `BEFORE_SWAP_RETURNS_DELTA` (caps, anti-snipe, whale tax), `afterSwap` +
`AFTER_SWAP_RETURNS_DELTA` (fee split, graduation trigger), and
`beforeAddLiquidity` / `beforeRemoveLiquidity` — **both hard-reverting for any
caller other than the hook itself.** Without these, a third party can add
liquidity and corrupt the curve. This is the single highest-severity omission
risk in the design.

### Unit tests (mock PoolManager)

| # | Test |
|---|---|
| U1 | Position seeded at `tick_upper` holds 800.000M token, 0 ETH (±1 wei) |
| U2 | Buy/sell quotes match `BondingCurve.quoteBuy/quoteSell` within 1 bps across 20 sizes spanning dust → graduation |
| U3 | `k` conserved across every swap (invariant assertion) |
| U4 | Derived virtual reserves within 0.01% of (6e18, 1.066666667e27) |
| U5 | Anti-snipe: swap in launch block reverts; `launchBlock + delay + 1` succeeds |
| U6 | Whale tax — each of the 5 tiers at boundary ±1 wei of mcap |
| U7 | Whale tax — tier changes as mcap crosses mid-life (re-evaluated per swap, not fixed at launch) |
| U8 | Creator split escalates 7500 → 8500 bps linearly with `cumulativeVolume` |
| U9 | Fees accrue to `creatorFeesOwed`/`protocolFeesOwed`; pull-payment withdrawal pays in full |
| U10 | Graduation fires exactly once at ≥4.2 ETH; bonus = 2.5% of raise |
| U11 | Post-graduation swaps still charge fee + whale tax (**the entire point of V4**) |
| U12 | `beforeAddLiquidity`/`beforeRemoveLiquidity` revert for every non-hook caller |
| U13 | Every callback reverts unless `msg.sender == poolManager` |
| U14 | No function mutates per-pool config after `afterInitialize` |
| U15 | Oracle failure → most conservative tier, no revert (if B1-A chosen) |

### Fuzz / invariant
- Random swap sequences: `k` non-decreasing (fees only add), reserves never
  negative, position never leaves `[tick_lower, tick_upper]` pre-graduation.
- Fee accounting: `Σ fees owed ≤ contract balance` at all times (this is the
  class of bug caught late in `GraduationMigrator` — see the fee-starvation cap).
- Graduation idempotence under reentrant/repeated swap attempts.

### Fork tests — real PoolManager
Against a live V4 `PoolManager` (Sepolia/Base Sepolia; pin block + commit hash):
full lifecycle deploy → mined hook address → initialize → seed → N buys to
graduation → verify in-place reshape → post-graduation swap still pays fees →
confirm no path can withdraw the LP.

### Differential test — the highest-value test here
Run identical trade sequences through deployed `BondingCurve.sol` and
`LoxleyHook`, assert outputs match within 1 bps. The old contract is already
tested and live-proven, so it is the best available oracle for the new one.

## 4. Deliverable 3 — audit engagement plan

**Gate: no real funds before two independent audits report zero
critical/high/medium findings** — matching the pmav standard cited in the brief.

| Phase | Content | Duration |
|---|---|---|
| 0. Internal | 100% branch coverage, Slither + Aderyn clean, fuzz ≥10M runs, differential suite green, frozen commit | 2–3 wk |
| 1. Spec package | This doc + threat model + invariant list + known-issues register (B1–B4 disclosed, *not* hidden) | 3 d |
| 2. Audit A | V4-hook specialist. Scope: hook permissions, callback gating, tick math, graduation atomicity, fee accounting | 2–3 wk |
| 3. Remediation | Fix, re-test, written response per finding | 1–2 wk |
| 4. Audit B | Different firm, no visibility into A's report until their own draft is issued | 2–3 wk |
| 5. Remediation | As above | 1–2 wk |
| 6. Public review | Cantina/Code4rena contest or 4-week public bounty | 4 wk |
| 7. Guarded launch | Deploy; cap per-pool raise well under 4.2 ETH for first N launches | 4 wk |

Firms with genuine V4-hook depth: **Trail of Bits, Spearbit/Cantina, OpenZeppelin,
ChainSecurity, Certora** (Certora especially for formal verification of the
constant-product invariant and fee-conservation properties).

Explicit non-negotiables to hand the auditors:
1. Fully immutable, no proxy, no upgrade path, no admin able to touch live params.
2. Every callback gated to `PoolManager`.
3. Third-party liquidity provision impossible on hooked pools.
4. LP permanently unwithdrawable post-graduation.
5. Graduation atomic — fully succeeds or fully reverts, curve state untouched.

**Budget:** two audits at this scope realistically land **$60k–150k** combined,
6–10 weeks elapsed excluding remediation. Novel V4-hook code prices at the upper
end; there is far less reviewer familiarity than with standard AMM code.

## 5. Sign-off required before implementation

1. **B1** — oracle call permitted, or tiers move to ETH?
2. **B2** — how is max-wallet handled once `sender` is a router? (Product decision.)
3. **B3** — accept the 1.9× graduation repricing, or bound the reshape range?
4. Confirm audit budget/timeline before engineering time is spent.

Items 1–3 change the contract's economics, not merely its implementation, so
they are cheaper to settle now than after an audit is underway.
