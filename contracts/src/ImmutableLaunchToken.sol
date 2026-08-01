// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @title ImmutableLaunchToken
/// @notice A minimal, fully immutable ERC-20 produced by the launchpad factory.
///
/// @dev Design decisions (why each "standard admin" feature is deliberately absent):
///
/// - NO OWNER / ACCESS CONTROL: the contract does not inherit `Ownable`,
///   `AccessControl`, or any variant. There is no address, anywhere, with
///   elevated permissions over this token after deployment. This is the
///   entire point of a fair-launch bonding-curve token: nobody — not the
///   deployer, not the factory, not the team — can later grant themselves
///   special treatment.
///
/// - NO MINT FUNCTION: `_mint` is called exactly once, inside the
///   constructor, and is never exposed through a public/external function.
///   Total supply is fixed forever the instant the contract is deployed.
///   This makes supply inflation attacks (and the need to "trust" an admin
///   not to inflate) structurally impossible rather than merely policy.
///
/// - NO ADMIN BURN: OpenZeppelin's base `ERC20` does not expose a public
///   `burn`, and this contract does not add `ERC20Burnable` or any burn
///   entrypoint. Holders can still send tokens to `address(0)`-adjacent
///   dead addresses if they personally want to burn their own balance, but
///   no privileged party can destroy tokens out of someone else's balance
///   or reduce circulating supply unilaterally.
///
/// - NO PAUSE: no `Pausable` mixin, no `whenNotPaused` modifier anywhere.
///   A pause switch is, functionally, a centralized kill switch over every
///   holder's ability to transfer — exactly the kind of discretionary power
///   this token is designed to not have.
///
/// - NO BLACKLIST: no address-based transfer restriction of any kind.
///   `transfer`/`transferFrom` behave exactly as OpenZeppelin's audited
///   `ERC20._update` implements them, unmodified. No one can be frozen out
///   of their own tokens.
///
/// - NO UPGRADEABILITY / NO PROXY: this is a plain, non-upgradeable contract
///   deployed directly (no `Initializable`, no `delegatecall` proxy in
///   front of it). The bytecode that goes live on Arbitrum Sepolia /
///   Robinhood Chain is the bytecode that runs forever — there is no
///   admin key that can swap the implementation later.
///
/// - DECIMALS FIXED AT CONSTRUCTION: OpenZeppelin v5's `ERC20` hardcodes
///   `decimals() == 18` unless overridden. Because the factory may want to
///   deploy tokens with non-18 decimals, `decimals_` is captured into an
///   `immutable` slot at construction and the `decimals()` view is
///   overridden to return it. `immutable` means it is baked into the
///   deployed bytecode / stored in a slot that can never be written to
///   again after the constructor returns — not a mutable admin-settable
///   value.
///
/// Everything else (name, symbol, transfer, approve, transferFrom,
/// allowance, balanceOf, totalSupply) is inherited unmodified from
/// OpenZeppelin's audited `ERC20` implementation — we deliberately do not
/// hand-roll ERC-20 accounting logic, since that's the highest-risk part
/// of any token contract to get subtly wrong.
contract ImmutableLaunchToken is ERC20 {
    /// @dev Fixed at deploy time, immutable thereafter. See rationale above.
    uint8 private immutable _decimals;

    /// @param name_ Token name, e.g. "Saylis Doge".
    /// @param symbol_ Token ticker, e.g. "LDOGE".
    /// @param decimals_ Decimal precision, fixed forever after deployment.
    /// @param totalSupply_ The entire fixed supply, denominated in the
    ///        smallest unit (i.e. already scaled by `10 ** decimals_`).
    /// @param curve The bonding-curve contract address that receives 100%
    ///        of the initial supply. This is intentionally the ONLY
    ///        possible recipient of the mint — there is no code path that
    ///        can send any portion of the initial supply to `msg.sender`
    ///        (the factory / deployer) or to any other admin-controlled
    ///        address, satisfying "never to the deployer or an admin
    ///        wallet".
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 totalSupply_,
        address curve
    ) ERC20(name_, symbol_) {
        require(curve != address(0), "ImmutableLaunchToken: curve is zero address");
        require(totalSupply_ > 0, "ImmutableLaunchToken: zero total supply");

        _decimals = decimals_;

        // The one and only mint this contract will ever perform. `_mint`
        // is OpenZeppelin's internal function; it is not re-exposed
        // anywhere, so this line is the entire lifetime supply issuance.
        _mint(curve, totalSupply_);
    }

    /// @dev Overrides OpenZeppelin's default `decimals() == 18` to return
    /// the value fixed at construction. Pure view over an immutable slot —
    /// no admin can change it post-deployment.
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
