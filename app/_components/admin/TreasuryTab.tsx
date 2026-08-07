"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient, useReadContracts, useWalletClient } from "wagmi";
import { formatEther, type Address } from "viem";
import Icon from "@/app/_components/Icon";
import AsciiSpinner from "@/app/_components/AsciiSpinner";
import { supabase } from "@/app/_lib/supabase";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { PROTOCOL_TREASURY_ADDRESS } from "@/app/_lib/contracts/config";
import { truncateAddress } from "@/app/_lib/format";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import { writeWithGas } from "@/app/_lib/txGas";

type CurveRow = { ticker: string; curveAddress: Address };

/**
 * Protocol fees, per curve, with a claim button.
 *
 * WHY EACH CURVE HAS TO BE CLAIMED SEPARATELY
 *
 * Fees are not swept anywhere as they accrue — each bonding curve holds its
 * own `protocolFeesOwed` until someone pulls it. So there is no single
 * balance to read or claim; the total is a sum across every curve ever
 * launched, and claiming is one transaction per curve with a non-zero
 * balance. That is a property of the contracts, not a limitation here.
 *
 * WHY THERE IS NO DESTINATION FIELD
 *
 * `withdrawProtocolFees()` takes no arguments and sends to the curve's own
 * immutable `protocolTreasury`. Nothing on this screen can redirect it, and
 * offering an address input would imply otherwise. The destination is shown
 * read-only, and read back from a curve rather than from our config
 * constant — the constant is only a label, the immutable is where the money
 * actually goes, and a mismatch between them is exactly the thing worth
 * seeing here.
 *
 * The call is permissionless — verified against the deployed curve from the
 * treasury, the creator, and an unrelated address, all of which succeed.
 * Since the destination is fixed, that is harmless: anyone calling it can
 * only move protocol fees to the protocol treasury, at their own gas cost.
 * It is exposed here because this is where someone would look for it.
 */
export default function TreasuryTab() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [curves, setCurves] = useState<CurveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCurve, setBusyCurve] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Address | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tokens")
        .select("ticker,curve_address")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setCurves(
        (data ?? [])
          .filter((row) => row.curve_address)
          .map((row) => ({
            ticker: row.ticker as string,
            curveAddress: row.curve_address as Address,
          }))
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One multicall for every curve's owed balance, plus the treasury each
  // one actually points at.
  const contracts = useMemo(
    () =>
      curves.flatMap((curve) => [
        {
          address: curve.curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "protocolFeesOwed",
        } as const,
        {
          address: curve.curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "protocolTreasury",
        } as const,
      ]),
    [curves]
  );

  const { data: reads, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const rows = useMemo(
    () =>
      curves.map((curve, i) => {
        const owed = reads?.[i * 2];
        const treasury = reads?.[i * 2 + 1];
        return {
          ...curve,
          owedWei: owed?.status === "success" ? (owed.result as bigint) : undefined,
          treasury:
            treasury?.status === "success" ? (treasury.result as Address) : undefined,
        };
      }),
    [curves, reads]
  );

  const totalWei = rows.reduce((sum, row) => sum + (row.owedWei ?? 0n), 0n);

  // Read from a curve, not from our constant — see the note above.
  const onChainTreasury = rows.find((row) => row.treasury)?.treasury;
  const treasuryMismatch =
    onChainTreasury !== undefined &&
    onChainTreasury.toLowerCase() !== PROTOCOL_TREASURY_ADDRESS.toLowerCase();

  const claim = useCallback(
    async (curveAddress: Address) => {
      if (!walletClient || !publicClient) return;
      setBusyCurve(curveAddress);
      setError(null);
      setClaimed(null);
      try {
        // Simulated first, so "nothing owed" and any other revert is caught
        // before the wallet opens rather than costing a failed transaction.
        const { request } = await publicClient.simulateContract({
          address: curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "withdrawProtocolFees",
          account: walletClient.account,
        });
        await waitForReceipt(
          publicClient,
          await writeWithGas(
            publicClient,
            walletClient,
            request,
            walletClient.account?.address
          )
        );
        setClaimed(curveAddress);
        await refetch();
      } catch (err) {
        setError(getFriendlyErrorMessage(err));
      } finally {
        setBusyCurve(null);
      }
    },
    [walletClient, publicClient, refetch]
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-[11px] text-white/40">
        <AsciiSpinner /> loading curves...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <section>
        <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
          Protocol treasury
        </h2>

        <div className="pixel-frame pixel-card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-white/40">Destination</span>
            <span className="text-[11px] font-mono text-white/80 break-all text-right">
              {onChainTreasury ?? PROTOCOL_TREASURY_ADDRESS}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-white/40">Total unclaimed</span>
            <span className="text-sm font-bold">{formatEther(totalWei)} ETH</span>
          </div>

          {treasuryMismatch && (
            <p className="text-[11px] text-red-400 leading-relaxed">
              The deployed curves send to {truncateAddress(onChainTreasury!)}, which is
              not the address in config. The curve&apos;s value is the one that governs
              where funds go.
            </p>
          )}

          <p className="text-[11px] text-white/35 leading-relaxed">
            Fees sit on each curve until claimed — there is no single pool. Claiming
            sends to the address above, which is fixed in the curve and cannot be
            changed from here.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
          Curves ({rows.length})
        </h2>

        {error && (
          <p className="mb-3 text-[11px] text-red-400" role="alert">
            {error}
          </p>
        )}

        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div className="pixel-frame pixel-card divide-y divide-white/5">
            {rows.map((row) => {
              const owed = row.owedWei;
              const hasOwed = owed !== undefined && owed > 0n;
              const isBusy = busyCurve === row.curveAddress;

              return (
                <div
                  key={row.curveAddress}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold uppercase truncate">
                      {row.ticker}
                    </p>
                    <p className="text-[10px] font-mono text-white/30">
                      {truncateAddress(row.curveAddress)}
                    </p>
                  </div>

                  <span className="text-[12px] tabular-nums shrink-0">
                    {owed === undefined ? "—" : `${formatEther(owed)} ETH`}
                  </span>

                  <button
                    onClick={() => claim(row.curveAddress)}
                    disabled={!hasOwed || isBusy || !walletClient}
                    className="pixel-frame pixel-btn h-8 px-3 text-[11px] shrink-0 disabled:opacity-40"
                  >
                    {isBusy
                      ? "claiming..."
                      : claimed === row.curveAddress
                        ? "claimed"
                        : "claim"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-1">
        <Icon icon="pixelarticons:coin" className="text-xl text-white/25" />
      </div>
      <h2 className="text-sm font-bold text-white/70">No curves yet</h2>
      <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">
        Protocol fees appear here once a token has been launched and traded.
      </p>
    </div>
  );
}
