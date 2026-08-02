"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { getContractAddress, type Address, type PublicClient } from "viem";
import {
  TAXABLE_LAUNCH_TOKEN_ABI,
  TAXABLE_LAUNCH_TOKEN_BYTECODE,
} from "@/app/_lib/contracts/TaxableLaunchToken";
import { BONDING_CURVE_ABI, BONDING_CURVE_BYTECODE } from "@/app/_lib/contracts/BondingCurve";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";
import {
  DEFAULT_DELAY_BLOCKS,
  DEFAULT_ETH_USD_PRICE_WHOLE,
  DEFAULT_GRADUATION_THRESHOLD_WEI,
  DEFAULT_TOTAL_SUPPLY,
  DEFAULT_VIRTUAL_ETH_RESERVE,
  ETH_USD_PRICE_FEED_ADDRESS,
  GRADUATION_MIGRATOR_ADDRESS,
  INFOFI_CAMPAIGN_ADDRESS,
  MAX_INFOFI_BPS,
  MAX_SELL_TAX_BPS,
  PROTOCOL_TREASURY_ADDRESS,
  REFERRAL_VAULT_ADDRESS,
  TOKEN_DECIMALS,
  virtualTokenReserveFor,
} from "@/app/_lib/contracts/config";

const ONE_E18 = 10n ** 18n;

/**
 * Arbitrum Sepolia's base fee can move between the moment a wallet
 * estimates gas and the moment the signed tx actually lands, and some
 * wallets cache that estimate for a beat — enough to trip
 * "max fee per gas less than block base fee" if we just let the wallet's
 * default kick in. Pulling a fresh estimate immediately before EACH
 * deploy call and padding it generously avoids re-triggering that race.
 */
async function getBufferedFees(publicClient: PublicClient) {
  const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: ((maxFeePerGas ?? 0n) * 3n) / 2n, // +50%
    maxPriorityFeePerGas: ((maxPriorityFeePerGas ?? 0n) * 3n) / 2n,
  };
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /rate.?limit(ed)?/i.test(message);
}

/**
 * The public Arbitrum Sepolia RPC (sepolia-rollup.arbitrum.io/rpc) is
 * shared and will throttle bursts of requests — two deploy transactions
 * back-to-back is enough to occasionally trip it. Retry with exponential
 * backoff ONLY for rate-limit errors; anything else (a revert, a rejected
 * signature, insufficient funds) fails immediately since retrying won't
 * help. For heavier usage, point NEXT_PUBLIC_ROBINHOOD_RPC_URL at a
 * dedicated RPC (Alchemy/Infura/etc.) instead of the shared public one.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt === maxAttempts - 1) throw err;
      const delayMs = 1500 * 2 ** attempt; // 1.5s, 3s, 6s
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export type LaunchStatus =
  | "idle"
  | "deploying-token"
  | "deploying-curve"
  | "success"
  | "error";

export type LaunchResult = {
  tokenAddress: Address;
  curveAddress: Address;
  /**
   * The EXACT constructor arguments both contracts were deployed with,
   * captured here rather than recomputed by the caller.
   *
   * Source verification has to re-encode these byte-for-byte or the
   * explorer rejects the submission, so anything that rebuilds them from
   * config separately would silently break the moment a default changed.
   * This is the one place that knows what was really sent.
   */
  constructorArgs: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
    sellTaxBps: string;
    ethUsdPriceFeed: string;
    pairSetter: string;
    virtualEthReserve: string;
    virtualTokenReserve: string;
    creator: string;
    protocolTreasury: string;
    ethUsdPrice: string;
    delayBlocks: string;
    graduationThreshold: string;
    migrator: string;
    creatorFeeRecipient: string;
    infoFiBps: string;
    infoFiCampaign: string;
    referralVault: string;
  };
};

/**
 * Orchestrates the "factory pattern" deploy flow directly from the
 * connected wallet: no on-chain factory contract exists yet, so this hook
 * reproduces the same two-transaction sequence our Foundry deploy script
 * uses — predict the bonding curve's CREATE address one nonce ahead of the
 * token's, deploy the token with that address as its mint recipient, then
 * deploy the curve at that exact predicted address. The wallet pays gas
 * only; nothing here charges an additional platform fee.
 */
export function useLaunchToken() {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const launch = useCallback(
    async (params: {
      name: string;
      symbol: string;
      /** Whale sell tax in basis points (0-300, i.e. 0%-3%); see
       * BondingCurve's "SELL TAX" NatSpec. Defaults to 0 (disabled). */
      sellTaxBps?: number;
      /**
       * Where `withdrawCreatorFees()` pays out. Omit to send fees to the
       * launching wallet, which is what the contract does with a zero
       * address. Immutable once deployed.
       */
      creatorFeeRecipient?: Address;
      /**
       * Basis points of total supply locked into this launch's InfoFi
       * campaign pool (0-500, i.e. 0%-5%). Defaults to 0 (no campaign).
       */
      infoFiBps?: number;
    }): Promise<LaunchResult> => {
      if (!account) throw new Error("Connect a wallet first.");
      if (!publicClient) throw new Error("No RPC connection available.");
      if (!walletClient) throw new Error("Wallet client not ready.");

      const sellTaxBps = BigInt(params.sellTaxBps ?? 0);
      if (sellTaxBps < 0n || sellTaxBps > MAX_SELL_TAX_BPS) {
        throw new Error(`Sell tax must be between 0 and ${MAX_SELL_TAX_BPS} bps.`);
      }

      const infoFiBps = BigInt(params.infoFiBps ?? 0);
      if (infoFiBps < 0n || infoFiBps > MAX_INFOFI_BPS) {
        throw new Error(`InfoFi allocation must be between 0 and ${MAX_INFOFI_BPS} bps.`);
      }

      // Fail before the token deploy rather than after: the curve is the
      // SECOND transaction, so a missing campaign address would otherwise
      // burn gas on a token whose curve is guaranteed to revert.
      if (infoFiBps > 0n && /^0x0+$/.test(INFOFI_CAMPAIGN_ADDRESS)) {
        throw new Error(
          "InfoFiCampaign is not deployed yet. Set INFOFI_CAMPAIGN_ADDRESS in config.ts."
        );
      }

      const creatorFeeRecipient =
        params.creatorFeeRecipient ?? "0x0000000000000000000000000000000000000000";

      setError(null);
      setResult(null);

      try {
        // Predict the curve's CREATE address one nonce ahead of the token's.
        const nonce = await publicClient.getTransactionCount({ address: account });
        const predictedCurveAddress = getContractAddress({
          from: account,
          nonce: BigInt(nonce + 1),
        });

        // ---- Step 1: deploy the token, minting its entire supply to the
        // predicted curve address. ----
        setStatus("deploying-token");
        const totalSupplyBaseUnits = DEFAULT_TOTAL_SUPPLY * ONE_E18;

        const tokenTxHash = await withRateLimitRetry(async () =>
          walletClient.deployContract({
            abi: TAXABLE_LAUNCH_TOKEN_ABI,
            bytecode: TAXABLE_LAUNCH_TOKEN_BYTECODE,
            args: [
              params.name,
              params.symbol,
              TOKEN_DECIMALS,
              totalSupplyBaseUnits,
              predictedCurveAddress,
              sellTaxBps,
              ETH_USD_PRICE_FEED_ADDRESS,
              // Only the migrator may wire the pool up, once, at
              // graduation — which is what arms the post-graduation tax.
              GRADUATION_MIGRATOR_ADDRESS,
            ],
            ...(await getBufferedFees(publicClient)),
          })
        );
        const tokenReceipt = await withRateLimitRetry(() =>
          publicClient.waitForTransactionReceipt({ hash: tokenTxHash })
        );
        const tokenAddress = tokenReceipt.contractAddress;
        if (!tokenAddress) throw new Error("Token deployment did not return an address.");

        // ---- Step 2: deploy the curve. If the nonce prediction above was
        // wrong (e.g. another tx raced in between), the token's supply
        // won't actually be sitting at this new contract's address, and
        // its constructor's `balanceOf(address(this)) > 0` check will
        // revert loudly rather than silently deploying a broken curve. ----
        setStatus("deploying-curve");

        const virtualEthReserveWei = DEFAULT_VIRTUAL_ETH_RESERVE * ONE_E18;
        // Scaled to the SELLABLE supply, which shrinks when an InfoFi
        // allocation is carved out. See `virtualTokenReserveFor` for why a
        // fixed value would quietly erode graduation headroom.
        const virtualTokenReserveBaseUnits =
          virtualTokenReserveFor(Number(infoFiBps)) * ONE_E18;
        const ethUsdPriceWei = DEFAULT_ETH_USD_PRICE_WHOLE * ONE_E18;

        const curveTxHash = await withRateLimitRetry(async () =>
          walletClient.deployContract({
            abi: BONDING_CURVE_ABI,
            bytecode: BONDING_CURVE_BYTECODE,
            args: [
              tokenAddress,
              virtualEthReserveWei,
              virtualTokenReserveBaseUnits,
              account, // creator = the connected wallet launching the token
              PROTOCOL_TREASURY_ADDRESS,
              ethUsdPriceWei,
              DEFAULT_DELAY_BLOCKS,
              DEFAULT_GRADUATION_THRESHOLD_WEI,
              GRADUATION_MIGRATOR_ADDRESS,
              sellTaxBps,
              ETH_USD_PRICE_FEED_ADDRESS,
              creatorFeeRecipient,
              infoFiBps,
              // Only meaningful when an allocation was actually set; the
              // constructor ignores it at 0 bps.
              infoFiBps > 0n
                ? INFOFI_CAMPAIGN_ADDRESS
                : "0x0000000000000000000000000000000000000000",
              REFERRAL_VAULT_ADDRESS,
            ],
            ...(await getBufferedFees(publicClient)),
          })
        );
        const curveReceipt = await withRateLimitRetry(() =>
          publicClient.waitForTransactionReceipt({ hash: curveTxHash })
        );
        const curveAddress = curveReceipt.contractAddress;
        if (!curveAddress) throw new Error("Curve deployment did not return an address.");

        const launchResult: LaunchResult = {
          tokenAddress,
          curveAddress,
          // Mirrors the two `args` arrays above exactly — see the type's
          // doc comment for why these are captured rather than recomputed.
          constructorArgs: {
            name: params.name,
            symbol: params.symbol,
            decimals: TOKEN_DECIMALS,
            totalSupply: totalSupplyBaseUnits.toString(),
            sellTaxBps: sellTaxBps.toString(),
            ethUsdPriceFeed: ETH_USD_PRICE_FEED_ADDRESS,
            pairSetter: GRADUATION_MIGRATOR_ADDRESS,
            virtualEthReserve: virtualEthReserveWei.toString(),
            virtualTokenReserve: virtualTokenReserveBaseUnits.toString(),
            creator: account,
            protocolTreasury: PROTOCOL_TREASURY_ADDRESS,
            ethUsdPrice: ethUsdPriceWei.toString(),
            delayBlocks: DEFAULT_DELAY_BLOCKS.toString(),
            graduationThreshold: DEFAULT_GRADUATION_THRESHOLD_WEI.toString(),
            migrator: GRADUATION_MIGRATOR_ADDRESS,
            creatorFeeRecipient,
            infoFiBps: infoFiBps.toString(),
            infoFiCampaign:
              infoFiBps > 0n
                ? INFOFI_CAMPAIGN_ADDRESS
                : "0x0000000000000000000000000000000000000000",
            referralVault: REFERRAL_VAULT_ADDRESS,
          },
        };
        setResult(launchResult);
        setStatus("success");
        return launchResult;
      } catch (err) {
        setStatus("error");
        setError(getFriendlyErrorMessage(err));
        throw err;
      }
    },
    [account, publicClient, walletClient]
  );

  return { launch, status, error, result, reset };
}
