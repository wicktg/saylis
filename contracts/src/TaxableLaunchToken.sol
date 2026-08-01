// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";

/// @title TaxableLaunchToken
/// @notice An immutable ERC-20 that keeps charging the launchpad's whale
///         sell tax *after* the token graduates to a Uniswap pool.
///
/// @dev WHY THIS EXISTS
///
/// `BondingCurve` charges a fee and a tiered whale sell tax on every trade,
/// but only while trading happens on the curve. Once a token graduates and
/// migrates to a Uniswap V3 pool, trades go straight to that pool, which
/// knows nothing about creators or taxes — so every post-graduation trade
/// historically produced zero income for the creator or the protocol.
///
/// Moving the tax into the *token* closes that gap. `_update` runs on every
/// transfer regardless of which router, aggregator, or interface initiated
/// it, so the tax applies everywhere, forever, with no cooperation needed
/// from any frontend.
///
/// It also restores a property that a pool-level (e.g. Uniswap V4 hook)
/// implementation cannot have: `_update` sees the *real* wallet on both
/// sides of a trade, not the router contract, so seller-balance-based whale
/// tiers are actually enforceable.
///
/// @dev WHAT IS TAXED
///
/// Only SELLS INTO THE AMM PAIR (`to == ammPair`), matching the curve's
/// sell-only tax. Buys, and ordinary wallet-to-wallet transfers, are never
/// taxed. Before `ammPair` is set — i.e. the entire bonding-curve phase —
/// nothing matches, so curve trades are untouched and can never be
/// double-taxed.
///
/// The tax is taken IN TOKENS (a transfer hook only sees token amounts) and
/// forwarded to `feeCollector`, which converts it to ETH in a separate
/// transaction. Swapping inside a transfer is the single most exploited
/// pattern in tax-token history — reentrancy and sandwiching — so this
/// contract never does it.
///
/// @dev IMMUTABILITY
///
/// Everything is `immutable` except `ammPair`/`feeCollector`, which are
/// write-once: the pool does not exist until graduation, so its address
/// cannot be known at construction. `pairSetter` (the migrator) may set
/// them exactly once, and the setter reverts forever after. There is no
/// owner, no pause, no blacklist, no mint, and no way to change the tax
/// rate after deployment.
contract TaxableLaunchToken is ERC20 {
    // ---------------------------------------------------------------
    // Constants — mirror BondingCurve's tier table exactly.
    // ---------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard ceiling on the creator-configured sell tax (3%).
    uint256 public constant MAX_SELL_TAX_BPS = 300;

    uint256 public constant WHALE_TIER_1_MCAP_USD = 150_000e18;
    uint256 public constant WHALE_TIER_2_MCAP_USD = 300_000e18;
    uint256 public constant WHALE_TIER_3_MCAP_USD = 500_000e18;
    uint256 public constant WHALE_TIER_4_MCAP_USD = 1_000_000e18;

    uint256 public constant WHALE_TIER_1_BPS = 200; // 2.00% of supply
    uint256 public constant WHALE_TIER_2_BPS = 150; // 1.50%
    uint256 public constant WHALE_TIER_3_BPS = 100; // 1.00%
    uint256 public constant WHALE_TIER_4_BPS = 75; // 0.75%
    uint256 public constant WHALE_TIER_5_BPS = 50; // 0.50%

    /// @notice Chainlink answers older than this are treated as unusable.
    uint256 public constant PRICE_STALENESS_THRESHOLD = 3 hours;

    // ---------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------

    uint8 private immutable _decimals;

    /// @notice Creator-chosen sell tax, in bps (0-300). Zero disables the
    ///         tax entirely and makes `_update` a plain ERC-20 transfer.
    uint256 public immutable sellTaxBps;

    /// @notice Live ETH/USD feed, used to price market cap for tiering.
    AggregatorV3Interface public immutable ethUsdPriceFeed;
    uint8 public immutable ethUsdPriceFeedDecimals;

    /// @notice The only address permitted to call `setAmmPair`, once.
    address public immutable pairSetter;

    // ---------------------------------------------------------------
    // Write-once state
    // ---------------------------------------------------------------

    /// @notice The Uniswap V3 pool this token graduated into. Zero until
    ///         graduation; sells are untaxed while it is zero.
    address public ammPair;

    /// @notice Destination for collected tax. Set alongside `ammPair`.
    address public feeCollector;

    event AmmPairSet(address indexed pair, address indexed collector);
    event SellTaxCollected(address indexed seller, uint256 amount);

    error PairAlreadySet();
    error NotPairSetter();
    error ZeroAddress();
    error SellTaxTooHigh();

    /// @param recipient_ Receives the entire supply — the bonding curve.
    /// @param sellTaxBps_ Creator-chosen sell tax, 0-300 bps.
    /// @param ethUsdPriceFeed_ Chainlink ETH/USD aggregator.
    /// @param pairSetter_ Address allowed to wire the pool up post-launch
    ///        (the GraduationMigrator).
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 totalSupply_,
        address recipient_,
        uint256 sellTaxBps_,
        address ethUsdPriceFeed_,
        address pairSetter_
    ) ERC20(name_, symbol_) {
        if (recipient_ == address(0)) revert ZeroAddress();
        if (ethUsdPriceFeed_ == address(0)) revert ZeroAddress();
        if (pairSetter_ == address(0)) revert ZeroAddress();
        if (sellTaxBps_ > MAX_SELL_TAX_BPS) revert SellTaxTooHigh();

        _decimals = decimals_;
        sellTaxBps = sellTaxBps_;
        ethUsdPriceFeed = AggregatorV3Interface(ethUsdPriceFeed_);
        ethUsdPriceFeedDecimals = AggregatorV3Interface(ethUsdPriceFeed_).decimals();
        pairSetter = pairSetter_;

        _mint(recipient_, totalSupply_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // ---------------------------------------------------------------
    // Graduation wiring
    // ---------------------------------------------------------------

    /// @notice Wires up the graduated pool and the tax destination. Callable
    ///         exactly once, by `pairSetter` only.
    ///
    /// @dev MUST be called AFTER liquidity has been seeded into the pool.
    ///      Seeding transfers tokens *to* the pool address, which is exactly
    ///      the shape of a taxed sell — setting the pair afterwards keeps
    ///      the migration itself untaxed without needing an exemption list.
    function setAmmPair(address pair_, address collector_) external {
        if (msg.sender != pairSetter) revert NotPairSetter();
        if (ammPair != address(0)) revert PairAlreadySet();
        if (pair_ == address(0) || collector_ == address(0)) revert ZeroAddress();

        ammPair = pair_;
        feeCollector = collector_;
        emit AmmPairSet(pair_, collector_);
    }

    // ---------------------------------------------------------------
    // Pricing / tiering
    // ---------------------------------------------------------------

    /// @notice Spot price of one whole token, in wei of ETH, read from the
    ///         graduated pool.
    ///
    /// @dev Uses the pool's `slot0` spot price. Uniswap V3 writes `slot0`
    ///      before it performs the swap's token transfers, so a read from
    ///      inside `_update` observes consistent post-swap state.
    ///
    ///      This is spot, not TWAP, and is therefore manipulable within a
    ///      single transaction. The exposure is bounded and one-directional:
    ///      the only profitable manipulation is pushing price DOWN to land
    ///      in a more lenient tier and dodge at most 3% of one sell, which
    ///      costs pool fees in both directions. It risks protocol revenue,
    ///      never user funds. A TWAP read is the hardening step if that
    ///      trade-off stops holding.
    function currentPriceWei() public view returns (uint256 priceWei, bool valid) {
        address pair = ammPair;
        if (pair == address(0)) return (0, false);

        try IUniswapV3Pool(pair).slot0() returns (
            uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool
        ) {
            if (sqrtPriceX96 == 0) return (0, false);

            bool tokenIsToken0 = IUniswapV3Pool(pair).token0() == address(this);
            uint256 one = 10 ** uint256(_decimals);

            // price = (sqrtPriceX96 / 2^96)^2, expressed as the paired
            // asset per one whole token. Squaring is split in two steps
            // because sqrtPriceX96^2 can exceed uint256.
            uint256 sqrtP = uint256(sqrtPriceX96);
            if (tokenIsToken0) {
                // token1 per token0
                uint256 intermediate = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
                priceWei = Math.mulDiv(intermediate, one, 1 << 96);
            } else {
                // token0 per token1 — invert
                uint256 intermediate = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
                if (intermediate == 0) return (0, false);
                priceWei = Math.mulDiv(one, 1 << 96, intermediate);
            }

            return (priceWei, priceWei > 0);
        } catch {
            return (0, false);
        }
    }

    /// @notice Live market cap in USD, 18-decimal fixed point.
    function currentMarketCapUsd() public view returns (uint256 mcapUsd18, bool valid) {
        (uint256 priceWei, bool priceValid) = currentPriceWei();
        if (!priceValid) return (0, false);

        try ethUsdPriceFeed.latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0) return (0, false);
            if (block.timestamp > updatedAt + PRICE_STALENESS_THRESHOLD) return (0, false);

            uint256 totalSupplyWhole = totalSupply() / (10 ** uint256(_decimals));
            uint256 mcapWei = priceWei * totalSupplyWhole;
            mcapUsd18 =
                Math.mulDiv(mcapWei, uint256(answer), 10 ** uint256(ethUsdPriceFeedDecimals));
            return (mcapUsd18, true);
        } catch {
            return (0, false);
        }
    }

    /// @notice Whale threshold implied by live market cap. Falls back to the
    ///         most LENIENT tier when price is unavailable, so an oracle
    ///         outage can never over-tax holders.
    function currentWhaleThresholdBps() public view returns (uint256) {
        (uint256 mcapUsd18, bool valid) = currentMarketCapUsd();
        if (!valid) return WHALE_TIER_1_BPS;
        if (mcapUsd18 <= WHALE_TIER_1_MCAP_USD) return WHALE_TIER_1_BPS;
        if (mcapUsd18 <= WHALE_TIER_2_MCAP_USD) return WHALE_TIER_2_BPS;
        if (mcapUsd18 <= WHALE_TIER_3_MCAP_USD) return WHALE_TIER_3_BPS;
        if (mcapUsd18 <= WHALE_TIER_4_MCAP_USD) return WHALE_TIER_4_BPS;
        return WHALE_TIER_5_BPS;
    }

    /// @notice Balance above which a seller counts as a whale right now.
    function currentWhaleThresholdTokens() public view returns (uint256) {
        return (totalSupply() * currentWhaleThresholdBps()) / BPS_DENOMINATOR;
    }

    /// @notice Tax that would be charged if `seller` sold `amount` now.
    function quoteSellTax(address seller, uint256 amount) public view returns (uint256) {
        if (sellTaxBps == 0) return 0;
        if (ammPair == address(0)) return 0;
        if (balanceOf(seller) <= currentWhaleThresholdTokens()) return 0;
        return (amount * sellTaxBps) / BPS_DENOMINATOR;
    }

    // ---------------------------------------------------------------
    // Transfer hook
    // ---------------------------------------------------------------

    /// @dev Taxes sells into `ammPair`. Deliberately exempt:
    ///      - everything before graduation (`ammPair == 0`)
    ///      - the fee collector's own sells, which convert collected tax to
    ///        ETH and would otherwise be taxed a second time
    ///      - mints and burns (`from`/`to` zero), which carry no pair
    function _update(address from, address to, uint256 value) internal override {
        address pair = ammPair;

        if (
            pair != address(0) && to == pair && from != address(0) && from != feeCollector
                && sellTaxBps != 0
        ) {
            // Balance is read pre-deduction, matching the curve, which
            // tests the seller's balance BEFORE the sale.
            if (balanceOf(from) > currentWhaleThresholdTokens()) {
                uint256 tax = (value * sellTaxBps) / BPS_DENOMINATOR;
                if (tax > 0) {
                    super._update(from, feeCollector, tax);
                    emit SellTaxCollected(from, tax);
                    unchecked {
                        value -= tax;
                    }
                }
            }
        }

        super._update(from, to, value);
    }
}
