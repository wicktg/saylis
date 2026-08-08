/**
 * All docs content, as markdown-lite source (see ../_lib/markdown.tsx for
 * what's supported). One entry per slug in content.ts's DOCS_NAV.
 *
 * Every number in here matches the actual deployed contracts exactly --
 * this is documentation for a real, immutable system, not marketing copy.
 */
export const DOCS_CONTENT: Record<string, string> = {
  // ------------------------------------------------------------------
  // FOR TRADERS
  // ------------------------------------------------------------------

  overview: `
# What Saylis Is

Saylis is a token launchpad built around one idea: every mechanic that moves money should be verifiable by anyone, on-chain, without trusting a team's word for it.

Every token launched on Saylis gets its own **bonding curve**: a small, immutable smart contract that prices the token against ETH using a simple, public formula. There is no presale, no team allocation carved out in secret, no admin key that can pause trading, mint more supply, or blacklist a wallet. What you see in the contract is the entire system.

When a token raises enough real ETH, it **graduates**: its liquidity moves permanently into a Uniswap V3 pool, and the LP position is sealed in a contract with no owner and no withdrawal function; not a timelock, not a multisig, not something with a future unlock date. After that point, nobody, including the Saylis team, can ever pull that liquidity.

This section of the docs explains what you're actually looking at as a trader: how price is set, what protections exist against sniping and whale dumps, and what graduation actually means for the token you're holding.

> [!note] Every contract referenced in these docs is linked with its real deployed address on Robinhood Chain; see **Reference -> Contract Addresses**. Nothing here is a claim you have to take on faith.
`,

  "bonding-curve": `
# How the Bonding Curve Works

Every token launches with its own **BondingCurve** contract holding the token's entire sellable supply. Price is not set by anyone; it's computed live from a constant-product formula, the same shape Uniswap V2 pools use:

\`\`\`
price = ethReserve / tokenReserve
\`\`\`

Both reserves start with a **virtual offset** baked in at launch (extra "phantom" liquidity that isn't real ETH or real tokens, just numbers used in the pricing formula). This is what makes the very first buy have a sane price instead of an infinite one; without a virtual offset, a curve starting at zero real reserves would divide by zero.

As people buy, real ETH flows into \`realEthReserve\` and real tokens flow out of \`realTokenReserve\`; price rises smoothly along the curve. As people sell, the reverse happens and price falls. There's no order book, no market makers, no slippage surprises beyond what the formula itself implies: you can compute your exact expected output before sending a transaction, and the contract enforces a minimum-output slippage check (\`minTokensOut\` / \`minEthOut\`) so a trade either executes at the price you expected or reverts entirely.

## The 1% trade fee

Every buy and every sell pays a flat **1% fee**, split **75% to the token's creator and 25% to the protocol treasury**; see **For Creators -> Fee Structure** for the details.

## What happens to your ETH

- **Buying**: your ETH (minus the 1% fee) becomes real reserve backing the token you just received. It sits in the curve contract until someone sells, graduates the token, or the creator/protocol withdraws their accrued fee share.
- **Selling**: you receive ETH straight out of the curve's real reserve, again minus the 1% fee (and the whale tax, if it applies to you; see **Whale Sell Tax Tiers**).

## No order book, no external price feed

The curve never looks outside itself for price; no oracle, no off-chain matching engine. The only external price feed used anywhere in this system is a Chainlink ETH/USD feed, and it exists purely to gate the whale tax tiers in USD terms; it never touches the curve's own token pricing.
`,

  "anti-snipe-max-wallet": `
# Anti-Snipe & Max-Wallet Cap

Two protections exist specifically to blunt the most common bot patterns on a brand-new launch. Both apply **only to buys**: selling is never restricted, because a seller is only ever reducing their own exposure, never acquiring an unfair position.

## Anti-snipe delay

Every curve is deployed with a small \`delayBlocks\` window (typically 1 block). Any \`buy\` attempted at or before \`launchBlock + delayBlocks\` reverts outright. This exists specifically to stop the same-block bundled "deploy + snipe" pattern, where a bot buys in the exact transaction the token launches in, before any real person has had a chance to see it.

It is **not** a trading pause with an "unlock" moment someone has to trigger; once the window passes, buying behaves exactly as it always will, forever, with zero further gating.

## Max-wallet cap: 2.5% of supply

No single wallet may hold more than **2.5% of total supply** as the result of a buy. If a buy would push your resulting balance over that line, the whole transaction reverts; never a partial fill, never a silently-adjusted amount.

\`\`\`
maxWalletTokens = totalSupply * 250 / 10_000   // 2.5%
\`\`\`

This is checked against your balance **after** the buy, so it accounts for tokens you already hold from earlier purchases; you can't work around it by buying multiple times either.

> [!note] The max-wallet cap only ever applies pre-graduation, on the curve itself. Once a token graduates and liquidity moves to a public Uniswap pool, ordinary DEX trading rules apply; there's no wallet cap enforceable at that layer.

Selling is exempt from both checks for the same reason: reducing a balance can never make the position more concentrated, and a fairness mechanic should never become an accidental "you can't exit your position" trap.
`,

  "whale-tax-tiers": `
# Whale Sell Tax Tiers

Separate from the ordinary 1% trade fee, a creator can optionally configure a **whale sell tax**: an extra tax that applies only to large sells, only from wallets holding more than a certain share of supply. The rate itself is creator-chosen (0-3%), but *whether it applies to a given sell* is decided by a fixed tier table based on the token's live market cap:

| Market cap | Whale threshold (% of total supply) |
|---|---|
| <= $150,000 | 2.00% |
| $150,000 - $300,000 | 1.50% |
| $300,000 - $500,000 | 1.00% |
| $500,000 - $1,000,000 | 0.75% |
| > $1,000,000 | 0.50% |

A seller only pays the tax if **their own balance, measured immediately before the sell**, exceeds the threshold implied by the token's current market cap. As the token's market cap grows, the bar for "whale" gets *lower*; a wallet holding 1% of supply is untaxed on a brand-new token but could cross into whale territory once the token has grown enough for 1% to represent real, concentrated value.

This is deliberately **live and dynamic**, not a snapshot taken at launch; the same wallet can move in and out of "whale" status over a token's life as both the price and the ETH/USD rate move.

## Market cap is read from a live oracle

Whale-tier gating is the one place this system reads a live price feed (a Chainlink-style ETH/USD oracle), used only to convert the curve's own ETH-denominated market cap into USD for the tier table above. If that feed is ever stale (more than a few hours old) or reports an invalid price, the check fails open into the **most lenient tier** (2%, hardest to trigger) rather than blocking the sell; an oracle outage can only ever *reduce* how much tax gets collected, never trap a seller's ability to exit.

## Buys are never taxed

The whale tax applies to sells only. Buying never triggers it, regardless of position size (the max-wallet cap handles buy-side concentration instead; see **Anti-Snipe & Max-Wallet Cap**).

## It keeps working after graduation

Once a token graduates and trading moves to its Uniswap pool, the exact same tier table keeps applying to sells into that pool; the tax logic lives partly in the token contract itself (not just the curve), so it survives the migration with no cooperation needed from any router or frontend. See **Trust & Safety** for why that matters.
`,

  graduation: `
# Graduation

A token **graduates** the moment its bonding curve has raised a fixed amount of real ETH (4.2 ETH by default, though this is configurable per launch and visible on-chain for every token). The moment that threshold is crossed, trading on the curve halts; permanently. There is no "un-graduating," no admin override, no path back to curve trading.

## What happens at the exact moment of graduation

1. The triggering buy still executes fully; a single transaction can simultaneously be someone's last curve purchase **and** the one that crosses the threshold.
2. \`graduated\` flips to \`true\`, a one-way latch nothing in the contract can ever reset.
3. The token's creator is credited a **graduation bonus**: see **For Creators -> Graduation Bonus**.
4. Both \`buy\` and \`sell\` revert unconditionally on this curve from then on.

## Migration: moving liquidity to a real DEX pool

Graduating and migrating are two separate steps. Migration (creating the actual Uniswap V3 pool and seeding it), is handled by a dedicated, permissionless contract (\`GraduationMigrator\`) that anyone can trigger once a curve has graduated. This keeps the curve's own, already-simple trading logic from ever having to reason about DEX integration.

Migration pulls together:

- The curve's remaining real ETH reserve
- The **20% liquidity reserve**: a slice of total supply held back, untouched, from the very first block (never sellable on the curve itself, existing purely to seed this pool)

...and mints a **full-range** Uniswap V3 liquidity position from them.

## The LP position is sealed permanently

The LP NFT that position mints is handed to that token's \`TokenFeeCollector\` in the same transaction: no owner, no admin, no unlock date. **There is no function anywhere in this system that could move that position or withdraw its liquidity, ever again, for any reason.** The collector can do exactly one thing the burn address could not: claim the pool's trading fees and pay them out. See **Trust & Safety -> LP Lock** for why that's a stronger guarantee than a locked-but-recoverable position, and **For Creators -> Fee Structure** for where those fees go.

## Trading after graduation

All trading moves to the public Uniswap pool. The bonding curve's own pricing/liquidity is done, but the whale sell tax keeps applying (see **Whale Sell Tax Tiers**), and everything the creator has already earned remains claimable exactly as before.
`,

  "reading-token-page": `
# How to Read a Token Page

Every field on a token's page is either read live from the chain or computed from data that's live from the chain; nothing is a cached marketing number. Here's what each figure actually means:

- **Market cap**: live price x total supply, computed from the curve's (or, post-graduation, the pool's) actual current reserves.
- **Progress bar / bonding curve progress**: how close \`realEthReserve\` is to the graduation threshold. Fills to 100% and freezes once graduated.
- **Volume**: the curve's own \`cumulativeVolume\`: the running gross ETH value of every trade this specific token has ever done.
- **Graduated / Migrated badges** (reflect the curve's own \`graduated\` and \`migrationExecuted\` flags directly. "Graduated" means the ETH threshold was hit and trading halted; "Migrated" means the DEX pool has actually been created and the LP permanently locked. There's a real, sometimes-brief gap between the two), a token can be graduated-but-not-yet-migrated.
- **Contract addresses**: the token and its curve are two separate, independently-viewable contracts. Both addresses link straight to the block explorer.

Nothing on a token page requires trusting Saylis specifically; every number here is independently reproducible by reading the same contract calls yourself.
`,

  // ------------------------------------------------------------------
  // FOR CREATORS
  // ------------------------------------------------------------------

  "launching-a-token": `
# Launching a Token

Launching deploys two contracts, back to back, straight from your own wallet; there is no factory contract taking a cut, no separate "approval" step, and nothing about the process is reversible or editable afterward.

## The steps

1. **Fill in the token's identity**: name, ticker, an optional image, an optional description and social links. All of this is stored off-chain for display purposes; the on-chain contracts themselves don't need any of it beyond name/symbol/decimals.
2. **Choose your configuration** (all immutable once launched):
   - **Whale sell tax rate** (0-3%, optional); see **Whale Tax, for Creators**.
   - **Fee redirect address** (optional); where your creator fee share actually pays out. See **Redirecting Your Fees**.
   - **InfoFi allocation** (0-5%, optional); reserve a slice of supply for an attention campaign at mint time. See **InfoFi Campaigns**.
3. **Sign two transactions**: the token deploy, then the curve deploy. Your wallet pays gas for both; there is no additional launch fee charged by the platform.

## What you're committing to, permanently

Every choice above is baked into the contracts' constructors as an **immutable** value. There is no settings page to come back to later; no way to raise your sell tax after the fact, no way to opt into an InfoFi allocation retroactively, no way to change where your fees pay out. Decide before you launch.

## What you don't have to decide

You never choose the total supply split, the virtual reserves, or the graduation threshold by hand; these follow fixed, documented defaults (1,000,000,000 total supply, 4.2 ETH graduation threshold) so every token on the platform is priced and compared on the same terms.
`,

  "fee-structure": `
# Fee Structure

Every trade (buy or sell) pays a flat **1% fee**, and that fee is always split the same way:

\`\`\`
creator  75%
protocol 25%
\`\`\`

There are no tiers, no milestones, and no volume thresholds. The share does not change with your token's age, its volume, or its market cap; it is a compile-time constant in the curve, and there is no owner, setter, or admin path that can move it after launch.

## It survives graduation

The 75/25 split is not a bonding-curve-only perk. After your token graduates to a DEX pool, you keep earning 75% of **two** separate streams:

- **The pool's 1% trading fee**, on every buy and every sell, forever. Your token's LP position is held by an immutable \`TokenFeeCollector\`, and anyone may call \`collect()\` to claim what it has earned. (This is why the position is locked rather than burned; a burned position earns the same fees but nobody can ever claim them. See **Trust & Safety -> LP Lock**.)
- **The whale sell tax**, which keeps applying on the pool exactly as it did on the curve.

## You are paid in both ETH and tokens

A Uniswap position earns in **both** pool assets, because V3 takes its fee out of whatever each trade paid in: buys arrive as ETH, sells arrive as tokens. So your 75% arrives partly as ETH and partly as tokens, and there are two balances to claim.

**Your tokens are never sold on your behalf.** Converting them automatically would mean the protocol dumping roughly 1% of all sell volume straight back into your pool, forever — permanent, one-directional sell pressure on your own chart. Instead you receive the tokens and decide yourself whether to hold or sell, and when.

The one exception is the protocol's own 25% of the token side, which is converted to ETH because the protocol treasury cannot hold ERC-20s at all. That sale is a quarter of one percent of sell volume rather than all of it, and it only happens when the pool's price passes an on-chain sanity check against its own time-weighted average — if the pool looks manipulated, the sale waits.

## The whale sell tax is 100% yours, on both sides

Before graduation the tax is taken in ETH out of the sale's proceeds. After graduation it is taken in tokens by the token's own transfer hook, because tokens are the only asset present at transfer time. Either way **the entire tax is yours** — no protocol cut and no referral cut, on either side of graduation.

## Referrals are paid from the ETH side only

If you were referred, the referrer takes 5% of your share — but only of your **ETH**, never your tokens. \`ReferralVault\` holds ETH and pools a referrer's earnings across every token they have referred; it has no way to hold tokens. Your token share is never reduced.

## Why it's flat

An earlier version of this curve escalated the creator's share from 75% up to 85% as cumulative volume climbed toward a fixed USD cap. In practice that cap sat roughly three hundred times further out than the graduation threshold, so no real token ever moved along the ramp: every creator earned the 75% floor while the docs advertised an 85% ceiling they could not reach. A flat 75% is what was actually being paid, so it is now simply what is written down and what the contract does.

## How you actually get paid

Fees are **never pushed** to you mid-trade. They accumulate in a balance you sweep whenever you want, by pressing Claim in your profile. This "pull payment" design is deliberate: if fees were pushed automatically and your receiving address ever reverted on incoming ETH, it would break trading for *everyone*, not just you.

Every one of these is permissionless — the destination is fixed in the contract regardless of who calls it, so anyone can trigger your payout but only you can receive it.

**Before graduation** there is one balance and one call:

\`\`\`solidity
curve.withdrawCreatorFees();       // your ETH
\`\`\`

**After graduation** your earnings live on your token's \`TokenFeeCollector\` instead, and there are two balances because you are paid in two assets:

\`\`\`solidity
collector.collect();               // sweep pool fees + sell tax into the balances
collector.withdrawCreatorFees();   // your ETH
collector.withdrawCreatorTokens(); // your tokens
\`\`\`

\`collect()\` is what moves fees out of the Uniswap position and into your claimable balance; it is permissionless, so it is usually already done for you before you ever press the button. The Claim button runs whichever of these still have something to do, so in practice you sign once or twice and the rest are skipped.

## Where the protocol's share goes

The remainder of every 1% fee (always computed as \`feeAmount - creatorFee\`, never as an independent calculation), goes to the protocol treasury, following the exact same pull-payment pattern.
`,

  "graduation-bonus": `
# Graduation Bonus

The moment your token crosses its graduation threshold, you're credited a one-time **graduation bonus**: 2.5% of the graduation threshold itself.

\`\`\`
bonus = graduationThreshold * 2.5%   // e.g. 4.2 ETH * 2.5% = 0.105 ETH
\`\`\`

A few details worth knowing:

- It's computed from the **configured threshold**, not from however much ETH the triggering buy actually pushed the reserve to. If a large buy overshoots the threshold in one jump, you still only earn the bonus on the threshold amount (not the overshoot), so the bonus is a fixed, predictable number known from the moment you launch.
- It's credited exactly once, through the same \`creatorFeesOwed\` pull-payment balance as your ordinary trade fees; there's no separate claim flow, no separate transaction. It just shows up in the same balance \`withdrawCreatorFees()\` already sweeps.
- The one-way \`graduated\` latch is what guarantees this never double-pays, even in edge cases where graduation logic runs more than once in the same code path.
`,

  "whale-tax-creator": `
# Whale Tax, for Creators

If you enable a whale sell tax at launch (0-3%, your choice, immutable once set), **100% of it comes to you**: none of it is shared with the protocol treasury, unlike the ordinary 1% trade fee.

## When it actually collects anything

The tax only applies to sells, and only from wallets whose balance clears the live whale threshold for the token's *current* market cap; see **Whale Sell Tax Tiers** for the exact table. A quiet token with no large holders can have a configured tax rate that simply never collects anything, and that's expected, not a bug.

## How it's paid to you

Like your ordinary fee share, the whale tax is credited to your \`creatorFeesOwed\` pull-payment balance directly; it shows up in the same balance, claimed through the same \`withdrawCreatorFees()\` call, with no separate flow to think about.

## It keeps working after graduation

This is the one piece of the fee system that lives partly **inside the token contract itself**, not just the curve; specifically so it keeps collecting on sells into the graduated Uniswap pool, where the curve itself no longer has any visibility into trades. Post-graduation collections are taken in tokens (since a transfer hook only ever sees token amounts), swapped to ETH in a separate transaction by a dedicated fee-collector contract, and become claimable the same way.

> [!note] Choose your whale tax rate carefully before launch; it cannot be raised, lowered, or removed afterward. Many creators launch with 0% and rely on the max-wallet cap alone; others use the full 3% specifically to discourage large, price-destabilizing dumps.
`,

  "fee-redirect": `
# Redirecting Your Fees

By default, \`withdrawCreatorFees()\` pays your accumulated fee share straight to the wallet that launched the token. At launch, you can optionally set a **different** payout address instead; a multisig, a treasury contract, a different personal wallet, whatever you want.

\`\`\`solidity
// creatorFeeRecipient_: pass address(0) to default to your launching
// wallet, or any other address to redirect payouts there instead.
\`\`\`

## What this does and doesn't change

- It only changes **where withdrawn ETH lands**. Your wallet is still permanently recorded as the token's \`creator\` for every other purpose; attribution, the whale sell tax calculation, the graduation bonus, InfoFi eligibility. Redirecting fees doesn't transfer "ownership" of the token in any sense, because there is no ownership concept to transfer in the first place.
- It's set once, at launch, and is immutable afterward; exactly like every other launch-time configuration choice. If you want to change your payout address later, there's no setter to call; the choice was final the moment the curve deployed.

## Why you might use this

Some creators route fees straight to a team multisig instead of a personal wallet from day one, or to a contract that automatically splits income between collaborators. Since the recipient is just a plain address as far as the contract is concerned, any of those work identically to a normal wallet.
`,

  "infofi-campaigns": `
# InfoFi Campaigns

An InfoFi campaign is a way to put a slice of your token's supply directly in the hands of the people who create attention for it; an airdrop pool, funded either at mint time or after the fact, distributed based on measured social engagement rather than a manual pick.

## Two paths into a campaign

**Path A: reserve at mint.** When you launch, you can set an InfoFi allocation between 0% and 5% of total supply. That slice is carved out of the curve's sellable supply at construction and transferred straight to the protocol-wide campaign contract before a single trade happens. No further action needed from you until the campaign becomes eligible.

**Path B: talk to the team, post-launch.** If you didn't reserve anything at mint but want a campaign later, there's no self-service form; you talk to the team directly (Telegram), and if it's a fit, the team invites your specific wallet for your specific token. From there:
1. You send the agreed token supply directly to the campaign contract's address (a plain transfer, not a swap).
2. You submit a title, description, and how many wallets should share the pool.
3. The team verifies the real on-chain balance actually arrived and registers the pool.

From that point on, both paths behave identically.

## Eligibility

A registered pool becomes **eligible** once the token's market cap has sustained a threshold for a continuous window; the team then reviews and manually opens it. There's no automatic payout trigger off a market-cap number alone: a human always has to look at the token and open the campaign. Crossing the bar is evidence a campaign is warranted, not authorization to pay one out by itself.

## Once opened

- The campaign runs for a **7-day window**, during which participants post about the token and get scored (see **For Campaign Participants**).
- Once the window closes and results are published, a **7-day claim window** opens.
- Whatever's left unclaimed after that becomes burnable by anyone; sent to the burn address, never recoverable by the team.

## What the team can never do

There is no function anywhere in the campaign contract that sweeps a pool to an address the team controls. The only two ways tokens ever leave a campaign pool are a participant claiming against a published, verifiable proof, or an expired claim window burning what's left. A creator who reserves 5% of supply for a campaign is not, at any point, handing it to anyone who could simply take it back.
`,

  "referral-program": `
# Referral Program

Refer another creator, and you earn **5% of their own creator fee share**: forever, across every single token they ever launch on Saylis, for as long as they keep trading.

## How it works

1. Share your referral link. Anyone who connects a wallet through it can permanently link you as their referrer with one signed transaction; this is one-way and can only ever be set once per wallet.
2. From that point on, every token that wallet launches automatically resolves your address as its referrer at the moment it deploys.
3. On every trade on any of their curves, **5% of their own creator-fee share** (never the protocol's share, never their sell tax, never their graduation bonus; specifically the 75% creator slice of the 1% trade fee) is redirected into your own balance instead of theirs.

\`\`\`
referralCut = creatorFee * 5%
creatorGets = creatorFee - referralCut     // the referred creator's own take, reduced only by this
\`\`\`

## It's genuinely lifetime, and genuinely unified

Because this routes through a single protocol-wide contract rather than being tracked separately per token, your earnings from every creator you've ever referred accumulate into **one balance**: you don't have to track down and withdraw from a dozen different curve contracts individually. One claim, whenever you want it, covers everything you've earned across every referral.

## What it costs the person you refer

Nothing beyond the 5% carve-out of their own share; the protocol's cut of every trade is completely unaffected by whether a creator was referred or not. A referred creator still earns their full 75% share on the *remaining* 95% of it; they just aren't the only one benefiting from their own success.

## Registration is permanent

Once a wallet registers a referrer, there's no way to change it; not by them, not by you, not by anyone. This is deliberate: a referral relationship that could be silently reassigned later wouldn't be trustworthy for either side.
`,

  // ------------------------------------------------------------------
  // FOR CAMPAIGN PARTICIPANTS
  // ------------------------------------------------------------------

  "joining-a-campaign": `
# Joining a Campaign

Joining a live campaign is free, reversible in effect, and takes one click; but it requires proving you actually control the X (Twitter) account you'll be posting from first.

## Before you can join

You need to link an X account to your wallet, once. This is done by pasting a short, randomly-generated code into your X bio and confirming it; a read-only check against your public profile, no password, no OAuth consent screen. This binding is permanent for your wallet; there's no re-linking to a different account later.

## Joining itself

Once your X account is linked, joining a live campaign is a single action; no signature, no gas, no on-chain footprint. It creates a record of your participation and, critically, sets your **scoring cutoff**: only posts made *after* the moment you join ever count toward your score. Joining late genuinely costs you reach; there's no way to backdate a join and have older posts retroactively count.

## What joining does and doesn't guarantee

Joining puts you in the running; it doesn't guarantee a reward. Only wallets that actually earn a non-zero score by the time the campaign window closes receive an allocation; joining with zero qualifying activity earns zero.
`,

  "valid-contributions": `
# Valid Contributions

Only two kinds of X activity ever count toward your score: **original posts** and **quote-tweets**, both mentioning the token's ticker, made after the moment you joined the campaign.

## What counts

- An original post mentioning the ticker.
- A quote-tweet mentioning the ticker.

## What never counts

- **Replies.** A reply thread can be gamed far too easily (mass-replying under someone else's viral post) compared to content someone chose to publish under their own name; replies are excluded entirely, regardless of content or engagement.
- Anything posted **before** you joined the campaign; your scoring cutoff is the moment you join, not the moment the campaign opened.
- Posts that don't mention the ticker at all.

## Why this specific line

The line between "quote-tweet" and "reply" isn't arbitrary; a quote-tweet is content you're standing behind on your own timeline, visible to your own followers, at your own reputational cost. A reply lives entirely inside someone else's thread and costs almost nothing to spam. The scoring formula (see **How Mindshare Is Calculated**) already weights different engagement types by how expensive they are to fake; excluding replies at the source is the same principle applied one level earlier.
`,

  "mindshare-calculation": `
# How Mindshare Is Calculated

Every qualifying post is scored using a weighted formula, then normalized against everyone else's total so the whole leaderboard sums to a fixed pool of **100 points**: regardless of whether ten people joined or ten thousand.

## The weights

\`\`\`
rawScore = views x 1
         + likes x 3
         + comments x 5
         + reposts x 4
\`\`\`

The weighting is ordered by how expensive each action is to fake, cheapest to most expensive:

- **Views (x1)**: almost entirely passive, the easiest number to inflate, so it counts for the least per unit.
- **Likes (x3)**: a single tap, but still a deliberate account action.
- **Reposts (x4)**: puts the content on the reposter's own timeline, a real reputational cost.
- **Comments (x5)**: someone had to write something; the most expensive signal to fake and the easiest to spot if faked.

Views aren't excluded, though; real reach still matters. The weighting just means a viral-but-ignored post can never outrank a smaller post that actually started real conversations.

## Normalizing to 100

\`\`\`
mindshare_i = 100 x rawScore_i / sum(rawScore for everyone in the campaign)
\`\`\`

If your posts generated zero engagement, your mindshare is 0; you keep your spot on the board (you joined, after all) but earn nothing when rewards are calculated. If literally nobody in a campaign has posted anything yet, everyone sits at 0 rather than the pool being divided by zero or split arbitrarily.

## Ties are broken deterministically

If two participants land on the exact same raw score, ranking falls back to comparing X usernames, so re-running the same day's numbers always produces the exact same ordering; never a coin-flip that could reshuffle who's "ahead."
`,

  "leaderboard-updates": `
# Leaderboard Updates

Standings update once every **24 hours**, on a fixed daily cycle, for as long as a campaign is live. Each day's numbers are calculated fresh and saved as a permanent snapshot; the record for a given day never gets silently rewritten later, even by a bug fix or a re-run.

## Why daily, not live

Pulling fresh engagement numbers for every participant is a real cost per check; scoring is done once a day, deliberately, rather than continuously, so a campaign's standings are meaningful and stable within a day rather than flickering with every refresh.

## What you'll see change day to day

- Your **mindshare score** for the current day.
- The **movement** since yesterday; both your mindshare delta and your rank delta, so "up 3 spots" and "down 1.2 points" are both visible at a glance.
- If you're brand new to the board (joined and scored for the first time), your movement is shown as new rather than compared against a non-existent previous day.

## The final standing

The very last daily snapshot taken before a campaign's window closes is what actually determines payouts; see **Claiming Rewards**. Everything before that is genuinely informative (it's real, permanent history) but only the final one is ever used to calculate who gets what.
`,

  "claiming-rewards": `
# Claiming Rewards

Once a campaign's 7-day window closes, the final leaderboard snapshot is turned into exact token allocations, and a single cryptographic proof of the entire distribution (a merkle root) is published on-chain by the team. From that moment, a **7-day claim window** is open.

## How to check and claim

1. On the campaign's page, click **Check Allocation**. This looks up whether your wallet earned anything from the final standings.
2. If you did, you'll see the exact amount; click **Claim**, sign the transaction, and the tokens transfer straight to your wallet.
3. If you didn't earn a non-zero score, you'll see that clearly rather than a confusing error.

## What actually happens on-chain

Your claim transaction submits your address, your exact allocated amount, and a cryptographic proof that the pair (\`your address\`, \`your amount\`) was genuinely part of the published distribution. The contract verifies that proof itself; it never trusts anything else about what amount you're claiming, so a claim can only ever succeed for the exact amount you were actually allocated.

## Claiming is one-time, permanently

Once you've claimed, you cannot claim again; the contract records that your address has claimed and rejects any further attempt outright, regardless of who signs it.

## If you miss the window

Once the 7-day claim window closes, any unclaimed portion of the pool becomes burnable by anyone; permanently sent to the burn address. There's no grace period and no way to reopen a closed claim window, so check back and claim promptly once a campaign you participated in has settled.
`,

  // ------------------------------------------------------------------
  // TRUST & SAFETY
  // ------------------------------------------------------------------

  "full-disclosure": `
# Full Disclosure Principle

Every mechanic that affects a token's price, supply, or your ability to trade it is visible on the token's own page, sourced directly from the contract, at the moment you're looking at it; never a static description that could drift out of sync with what the contract actually does.

## What's always shown

- **Fee structure**: the exact current creator/protocol split, live, not just the range.
- **Whale tax configuration**: the rate this specific token was launched with, and whether it's currently active for you given your own balance.
- **Max-wallet cap and anti-snipe status**: whether you're still inside the anti-snipe window, and what the actual cap is in tokens.
- **Graduation progress and threshold**: exactly how close the curve is, in real terms.
- **Contract addresses**: both the token and the curve, linked directly to the block explorer, for every token without exception.

## Why this matters more than a promise

A written claim that "the team can't rug this" is worth exactly as much as the team's honesty. A claim that's independently checkable against immutable bytecode is worth something regardless of who's making it; that's the entire design philosophy behind everything in **Immutable Contracts** and **LP Lock**. Full disclosure is what makes that checkability actually usable by someone who isn't a Solidity engineer: the numbers that matter are surfaced directly, not buried in a contract you'd have to read yourself to find.
`,

  "lp-lock": `
# LP Lock

When a token graduates, its liquidity position on Uniswap is minted once and immediately handed to that token's \`TokenFeeCollector\` in the same transaction. The collector has no owner, no admin, no setter, and no unlock date. It is not a timelock and it is not a multisig; it is a contract that is structurally incapable of releasing the position.

## Why this is a stronger guarantee than a "locked" LP

A locked LP position is typically held by a timelock or a vesting contract with a future unlock date; which means, by construction, *something* holds it and *something* will eventually be able to move it. That something might be trustworthy. It might also be a multisig with a bug, a timelock with an admin escape hatch, or simply a promise that a future team doesn't keep.

The collector removes the "something" from the equation. There is no unlock date because there is no unlock function. There is no admin who could be compromised because there is no admin. Every parameter is fixed at deploy time and every destination is hardcoded.

## The "code absence" concept

This is the important distinction: it's not that moving the LP is *forbidden* by a rule someone could break. It's that the *code required to do it doesn't exist anywhere in the deployed contracts*. Uniswap withdrawals go through \`decreaseLiquidity\`; the collector never calls it, and the interface it compiles against does not even declare it. There is no function whose job is "transfer this position out", no approval path, and no \`delegatecall\`. Not restricted ones, not admin-only ones; none at all. A rule can be violated. Code that was never written can't be.

## It used to be burned, and here is why that changed

Earlier versions sent the LP NFT to \`0x000...dEaD\`. That was an equally solid lock, and it had a flaw nobody benefited from: in Uniswap V3, trading fees accrue to the *position*, and the only way to realise them is \`collect()\`, which requires owning the position's NFT. An address with no private key can never call it. So every graduated token was permanently destroying the pool's entire fee income.

The collector keeps the lock and recovers that income for the creator. The exchange is deliberate and narrow: it gains the ability to claim fees, and gains nothing else. You can verify this the same way you would verify the burn; by reading the deployed bytecode, where the withdrawal functions simply are not present.

## What it means for automated scanners

Rug-checking tools decide "is the LP locked?" by matching the position's owner against a list of known burn addresses and known locker contracts. A purpose-built contract is on no such list, so some scanners will report this as an unrecognised holder rather than a clean burn. That is a limitation of list-matching, not of the lock: the guarantee here is stronger than most allowlisted lockers offer, because those can typically release liquidity on a timer and this cannot release it at all. The contract is verified on the explorer, so the claim is checkable in about thirty seconds by anyone who wants to.

## What this means for you as a holder

Once a token graduates and migrates, the liquidity backing its price on the open market cannot be pulled by the team, by an attacker who compromises the team's keys, by a future decision to "rebalance," or by anything else; ever, for the life of the pool.
`,

  "immutable-contracts": `
# Immutable Contracts

Every contract in this system (the bonding curve, the launch token, the migration contract, the InfoFi campaign singleton, the referral vault), shares the same posture: **no owner, no admin function, no pause, no mint beyond the fixed amount created at deployment, no blacklist.**

## What "no owner" actually means here

Most token contracts, even well-intentioned ones, have an \`owner\` address with elevated permissions: pause trading, mint more supply, blacklist a wallet, redirect fees, upgrade the logic. Saylis contracts simply don't have that role defined anywhere. There's no variable to check, no permission to revoke, no multisig to trust; the concept doesn't exist in the deployed bytecode.

## Concretely, none of these are possible, ever, on any Saylis token

- **Pausing trading.** There is no function that halts \`buy\`/\`sell\` other than the one-way graduation latch itself, which nothing controls except cumulative ETH raised.
- **Minting more supply.** Total supply is fixed at deployment, in the constructor, once. No function anywhere increases it afterward.
- **Blacklisting a wallet.** No mapping, no check, no function exists that could ever block a specific address from trading or holding.
- **Changing the fee split, the whale tax rate, or the graduation threshold** after launch. Every one of these is set once, in the constructor, as an \`immutable\` value; a fundamental account of the compiled bytecode, not a variable a transaction could change.
- **Sweeping a pool, a fee balance, or an LP position to a team-controlled address.** Covered in depth in **LP Lock** and **InfoFi Campaigns**: the short version is that no such function was ever written.

## Verifying this yourself

Every claim on this page is checkable directly against the deployed source (see **Reference -> Contract Addresses**); search for the word \`owner\`, \`onlyOwner\`, \`pause\`, \`mint\`, or \`blacklist\` in any contract here and you will not find a privileged version of any of them.
`,

  // ------------------------------------------------------------------
  // REFERENCE
  // ------------------------------------------------------------------

  "contract-addresses": `
# Contract Addresses

These are the protocol-wide singleton contracts; deployed once, shared by every token launched on the platform. Every individual token additionally deploys its own **ImmutableLaunchToken**/**TaxableLaunchToken** and **BondingCurve** pair, whose addresses are shown directly on that token's own page.

| Contract | Purpose |
|---|---|
| **ProtocolTreasury** | Receives the protocol's share of every trade fee across every token. |
| **GraduationMigrator** | Permissionlessly migrates a graduated curve's liquidity into a Uniswap V3 pool and seals the resulting LP position in that token's \`TokenFeeCollector\`. |
| **TokenFeeCollector** | Ownerless permanent custodian of one token's LP position, and the ledger its post-graduation fees are paid from. Can claim fees and nothing else; no withdrawal path for the liquidity exists. |
| **InfoFiCampaign** | Protocol-wide singleton holding every launch's InfoFi campaign pool, gating eligibility, and settling payouts against published proofs. |
| **ReferralVault** | Tracks referral relationships and holds every referrer's unified, lifetime pull-payment balance. |

> [!note] This is a **mainnet** deployment on **Robinhood Chain** (an Arbitrum Orbit L2, chain id **4663**). Trades settle in real ETH and real funds are at risk. Exact addresses are shown in-app wherever a contract is referenced; every token page links its own curve and token contract directly to the block explorer, and the connect-wallet flow enforces the correct network automatically.

## Reading the source yourself

Every contract mentioned throughout these docs (\`BondingCurve\`, \`TaxableLaunchToken\` / \`ImmutableLaunchToken\`, \`GraduationMigrator\`, \`InfoFiCampaign\`, \`ReferralVault\`), is verified on the block explorer, meaning the exact Solidity source that compiled to the deployed bytecode is publicly readable and directly comparable against what's described in these docs, line by line.
`,

  faq: `
# FAQ

## Why did my buy revert?

The most common causes, in order of likelihood:

- **Max-wallet cap.** Your resulting balance after the buy would exceed 2.5% of total supply. Try a smaller amount.
- **Slippage.** The price moved between when you quoted the trade and when it landed on-chain, and the actual output would have been worse than your \`minTokensOut\`. Try again with fresh numbers, or a slightly looser slippage tolerance.
- **Anti-snipe window.** You're attempting to buy in the same block (or within a couple of blocks) of the token's launch. Wait a few seconds and retry.
- **Token already graduated.** Once a curve graduates, \`buy\` reverts unconditionally; trading has moved to the Uniswap pool.

## What's the whale threshold for a specific token right now?

It depends on that token's *current* market cap, not a fixed number; see the table in **Whale Sell Tax Tiers**. The token's own page shows your live status (whether your current balance would trigger the tax on a sell) directly, so you don't have to compute it by hand.

## How do I claim my creator fees?

Call \`withdrawCreatorFees()\` on your token's bonding curve; or trigger it from your token's page, which does the same thing. It's permissionless (anyone can call it, including automated tooling), but funds only ever go to your fixed, immutable payout address, so there's no risk in someone else triggering it on your behalf.

## Can I change my token's settings after launch?

No. Every configuration choice (sell tax rate, fee redirect address, InfoFi allocation), is set once in the constructor and immutable afterward. This is deliberate, not a missing feature: mutable settings would mean trusting the creator not to change them later, which defeats the point of an immutable system.

## What happens to unclaimed InfoFi campaign tokens?

After the 7-day claim window following a campaign's settlement closes, whatever's left unclaimed becomes burnable by anyone, permanently. There's no recovery path and no grace period; see **Claiming Rewards**.

## Does the whale tax apply to my buy, or only my sell?

Only sells. Buying is never subject to the whale tax regardless of position size; the max-wallet cap is what governs buy-side concentration instead.

## Is there any way for the team to pause trading or blacklist my wallet?

No; there is no pause function and no blacklist mechanism anywhere in these contracts, for any token, ever. See **Immutable Contracts** for the full explanation and how to verify it yourself against the source.
`,
};
