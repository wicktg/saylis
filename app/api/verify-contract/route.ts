/**
 * POST /api/verify-contract  { tokenAddress, curveAddress, name, symbol, ... }
 *
 * Submits a freshly-launched token AND its bonding curve to the block
 * explorer for source verification, automatically.
 *
 * WHY THIS IS AUTOMATED RATHER THAN A CHORE
 *
 * Explorers verify contract ADDRESSES, not source code in the abstract, and
 * every launch deploys a brand-new token and curve at brand-new addresses.
 * Left manual that means verifying two contracts by hand after every single
 * launch, forever — which in practice means it never happens, and every
 * token on the platform permanently reads as "Unknown Contract".
 *
 * That is not cosmetic. Against unverified bytecode, automated auditors
 * decompile and guess, and they guess badly: our first mainnet token was
 * flagged CRITICAL "honeypot — every transfer sends tokens to the fee
 * collector", from a decompiler misreading `TaxableLaunchToken._update`'s
 * sell-tax branch. That branch cannot even execute pre-graduation (it is
 * gated on `ammPair != address(0)`, which is zero until migration), but a
 * scanner reading raw bytecode has no way to know that. Verified source
 * removes the guesswork entirely.
 *
 * The source itself never varies between launches — only the constructor
 * arguments do — so this is purely mechanical and belongs in code.
 *
 * WHY IT IS FIRE-AND-FORGET
 *
 * Verification is metadata, not state: a failure changes nothing on-chain
 * and nothing about whether the token works. It must never block or fail a
 * launch, so every error here is swallowed and reported in the response
 * body rather than thrown. Re-submitting an already-verified contract is
 * also harmless — the explorer just reports it as already verified.
 */
import { NextResponse } from "next/server";
import { encodeAbiParameters, isAddress, parseAbiParameters, type Address } from "viem";
import { TARGET_CHAIN } from "@/app/_lib/contracts/config";
import tokenStandardInput from "@/app/_lib/contracts/verification/TaxableLaunchToken.standard-input.json";
import curveStandardInput from "@/app/_lib/contracts/verification/BondingCurve.standard-input.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Blockscout's v2 verification endpoint, derived from the chain's own
 * explorer URL so this follows `TARGET_CHAIN` rather than hardcoding a
 * network. Standard-JSON-input is the only submission format that carries
 * `viaIR` and the optimizer settings with it — this project compiles with
 * `via_ir = true`, and a submission that omits it produces bytecode that
 * will not match, which is the usual reason a hand-made verification
 * silently fails.
 *
 * `apikey` is appended as a query param (Blockscout's own auth scheme —
 * a header is not honored) whenever `BLOCKSCOUT_API` is configured. Without
 * it, the public per-IP rate limit is tight enough that a handful of
 * verifications in quick succession — exactly what a busy launchpad
 * produces — gets throttled. A throttled request doesn't come back as a
 * clean error either: Blockscout's edge returns its own HTML page instead
 * of routing to the API, which reads like a wrong URL rather than a rate
 * limit if you don't already know to expect it.
 */
function verificationUrl(address: string): string | null {
  const explorer = TARGET_CHAIN.blockExplorers?.default?.url;
  if (!explorer) return null;
  const base = `${explorer.replace(/\/$/, "")}/api/v2/smart-contracts/${address}/verification/via/standard-input`;
  const apiKey = process.env.BLOCKSCOUT_API;
  return apiKey ? `${base}?apikey=${apiKey}` : base;
}

const COMPILER_VERSION = "v0.8.26+commit.8a97fa7a";

async function submit(params: {
  address: string;
  contractName: string;
  standardInput: unknown;
  constructorArgs: string;
}): Promise<{ ok: boolean; detail: string }> {
  const url = verificationUrl(params.address);
  if (!url) return { ok: false, detail: "No block explorer configured for this chain." };

  // Blockscout expects multipart/form-data with the standard-json as a file
  // part, not a JSON body.
  const form = new FormData();
  form.append("compiler_version", COMPILER_VERSION);
  form.append("contract_name", params.contractName);
  form.append("autodetect_constructor_args", "false");
  form.append("constructor_args", params.constructorArgs);
  form.append(
    "files[0]",
    new Blob([JSON.stringify(params.standardInput)], { type: "application/json" }),
    "standard-input.json"
  );

  try {
    // `cache: "no-store"` opts this out of Next's fetch patching.
    // Without it, a multipart FormData/Blob body was silently mangled
    // before it reached the network — same root cause diagnosed in
    // app/_lib/supabaseAdmin.ts for a different symptom (stale GET reads).
    // Here it produced a REQUEST malformed enough that Blockscout's proxy
    // served its default HTML error page instead of routing to the API,
    // rather than an outright failure — which is what made it look like a
    // wrong URL when the URL was actually correct.
    const response = await fetch(url, { method: "POST", body: form, cache: "no-store" });
    const text = await response.text();
    return { ok: response.ok, detail: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : "request failed" };
  }
}

export async function POST(request: Request) {
  let body: {
    tokenAddress?: string;
    curveAddress?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    totalSupply?: string;
    sellTaxBps?: string;
    ethUsdPriceFeed?: string;
    pairSetter?: string;
    virtualEthReserve?: string;
    virtualTokenReserve?: string;
    creator?: string;
    protocolTreasury?: string;
    ethUsdPrice?: string;
    delayBlocks?: string;
    graduationThreshold?: string;
    migrator?: string;
    creatorFeeRecipient?: string;
    infoFiBps?: string;
    infoFiCampaign?: string;
    referralVault?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tokenAddress = body.tokenAddress?.toLowerCase() ?? "";
  const curveAddress = body.curveAddress?.toLowerCase() ?? "";
  if (!isAddress(tokenAddress) || !isAddress(curveAddress)) {
    return NextResponse.json(
      { error: "Valid tokenAddress and curveAddress are required." },
      { status: 400 }
    );
  }

  const results: Record<string, { ok: boolean; detail: string }> = {};

  // ---- Token ----
  try {
    const args = encodeAbiParameters(
      parseAbiParameters("string, string, uint8, uint256, address, uint256, address, address"),
      [
        body.name ?? "",
        body.symbol ?? "",
        Number(body.decimals ?? 18),
        BigInt(body.totalSupply ?? "0"),
        curveAddress as Address,
        BigInt(body.sellTaxBps ?? "0"),
        (body.ethUsdPriceFeed ?? "") as Address,
        (body.pairSetter ?? "") as Address,
      ]
    );
    results.token = await submit({
      address: tokenAddress,
      contractName: "TaxableLaunchToken",
      standardInput: tokenStandardInput,
      constructorArgs: args.slice(2),
    });
  } catch (err) {
    results.token = {
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : "arg encoding failed",
    };
  }

  // ---- Curve ----
  try {
    const args = encodeAbiParameters(
      parseAbiParameters(
        "address, uint256, uint256, address, address, uint256, uint256, uint256, address, uint256, address, address, uint256, address, address"
      ),
      [
        tokenAddress as Address,
        BigInt(body.virtualEthReserve ?? "0"),
        BigInt(body.virtualTokenReserve ?? "0"),
        (body.creator ?? "") as Address,
        (body.protocolTreasury ?? "") as Address,
        BigInt(body.ethUsdPrice ?? "0"),
        BigInt(body.delayBlocks ?? "0"),
        BigInt(body.graduationThreshold ?? "0"),
        (body.migrator ?? "") as Address,
        BigInt(body.sellTaxBps ?? "0"),
        (body.ethUsdPriceFeed ?? "") as Address,
        (body.creatorFeeRecipient ?? "") as Address,
        BigInt(body.infoFiBps ?? "0"),
        (body.infoFiCampaign ?? "") as Address,
        (body.referralVault ?? "") as Address,
      ]
    );
    results.curve = await submit({
      address: curveAddress,
      contractName: "BondingCurve",
      standardInput: curveStandardInput,
      constructorArgs: args.slice(2),
    });
  } catch (err) {
    results.curve = {
      ok: false,
      detail: err instanceof Error ? err.message.slice(0, 200) : "arg encoding failed",
    };
  }

  return NextResponse.json({ submitted: true, results });
}
