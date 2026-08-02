#!/usr/bin/env node
/**
 * Regenerates the frontend's ABI+bytecode TypeScript constants directly from
 * `forge build`'s own output — for every contract the frontend deploys
 * client-side (TaxableLaunchToken, BondingCurve) or reads via a static ABI.
 *
 * WHY THIS HAS TO EXIST
 *
 * The frontend deploys tokens by calling `walletClient.deployContract()`
 * with a bytecode STRING baked into a .ts file — not by invoking `forge
 * script`. Nothing wired that constant to the actual Solidity source, so it
 * silently went stale the moment anyone edited contracts/src/*.sol without
 * also remembering to hand-regenerate the frontend file. That happened for
 * an entire security-audit pass: every fix landed in source, the frontend
 * kept shipping the pre-fix bytecode, and the first sign of the mismatch
 * was a real mainnet token failing verification with a bytecode compilers
 * could not reconcile against current source.
 *
 * Run this after EVERY change to contracts/src/*.sol that ships via the
 * frontend's client-side deploy path, before the next real launch:
 *
 *   cd contracts && forge build --force && node script/generate-frontend-artifacts.js
 *
 * It is intentionally a plain Node script, not a forge script — the output
 * is TypeScript for the Next.js app, which forge has no reason to know
 * about.
 */
const fs = require("fs");
const path = require("path");

const CONTRACTS_DIR = path.join(__dirname, "..");
const OUT_DIR = path.join(CONTRACTS_DIR, "out");
const FRONTEND_DIR = path.join(CONTRACTS_DIR, "..", "app", "_lib", "contracts");

/** Every contract the frontend needs ABI+bytecode for, and where its build
 * artifact lives relative to `out/`. */
const TARGETS = [
  {
    artifact: "TaxableLaunchToken.sol/TaxableLaunchToken.json",
    outFile: "TaxableLaunchToken.ts",
    abiName: "TAXABLE_LAUNCH_TOKEN_ABI",
    bytecodeName: "TAXABLE_LAUNCH_TOKEN_BYTECODE",
    header: `/**
 * Generated from contracts/out/TaxableLaunchToken.sol/TaxableLaunchToken.json
 * by contracts/script/generate-frontend-artifacts.js. DO NOT HAND-EDIT —
 * re-run that script after any change to contracts/src/TaxableLaunchToken.sol.
 *
 * The launch token that keeps charging the whale sell tax AFTER graduation:
 * the tax lives in the ERC-20 transfer hook, so it applies on every router
 * and DEX without any cooperation from this frontend. Replaces
 * ImmutableLaunchToken for all new launches; already-deployed tokens keep
 * their original (untaxed-post-graduation) behaviour, since both are
 * immutable by design.
 */`,
  },
  {
    artifact: "BondingCurve.sol/BondingCurve.json",
    outFile: "BondingCurve.ts",
    abiName: "BONDING_CURVE_ABI",
    bytecodeName: "BONDING_CURVE_BYTECODE",
    header: `/**
 * Generated from contracts/out/BondingCurve.sol/BondingCurve.json by
 * contracts/script/generate-frontend-artifacts.js. DO NOT HAND-EDIT —
 * re-run that script after any change to contracts/src/BondingCurve.sol.
 */`,
  },
];

/** Also regenerated: standard-JSON-input files used for automatic
 * source-code verification on the block explorer (see
 * app/api/verify-contract/route.ts). These have to compile from the exact
 * same source as the bytecode above, or verification fails the same way
 * this whole script exists to prevent. */
const VERIFICATION_TARGETS = [
  { contractName: "TaxableLaunchToken", sourcePath: "src/TaxableLaunchToken.sol" },
  { contractName: "BondingCurve", sourcePath: "src/BondingCurve.sol" },
];

function readArtifact(relPath) {
  const full = path.join(OUT_DIR, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Build artifact not found: ${full}\nRun "forge build --force" first.`
    );
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function writeContractFile(target) {
  const artifact = readArtifact(target.artifact);
  const abi = artifact.abi;
  const bytecode = artifact.bytecode?.object;
  if (!bytecode || bytecode === "0x") {
    throw new Error(`${target.artifact} has no deployable bytecode.`);
  }

  const abiJson = JSON.stringify(abi, null, 2);
  const content = `${target.header}
export const ${target.abiName} = ${abiJson} as const;

export const ${target.bytecodeName} =
  "${bytecode}" as const;
`;

  const outPath = path.join(FRONTEND_DIR, target.outFile);
  fs.writeFileSync(outPath, content);
  console.log(`wrote ${path.relative(CONTRACTS_DIR, outPath)} (bytecode: ${bytecode.length / 2 - 1} bytes)`);
}

function writeVerificationInput(target) {
  // forge's --show-standard-json-input needs a real (even if fake) address
  // and contract path:name target; it does not read from `out/`, it
  // recompiles, so this is also how we catch a source/artifact mismatch
  // rather than silently trusting stale `out/` files.
  const { execFileSync } = require("child_process");
  const result = execFileSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      "0x0000000000000000000000000000000000000000",
      `${target.sourcePath}:${target.contractName}`,
    ],
    { cwd: CONTRACTS_DIR, env: { ...process.env, ARBISCAN_API_KEY: "unused" }, maxBuffer: 1024 * 1024 * 50 }
  );

  const outDir = path.join(FRONTEND_DIR, "verification");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${target.contractName}.standard-input.json`);
  fs.writeFileSync(outPath, result);
  console.log(`wrote ${path.relative(CONTRACTS_DIR, outPath)} (${result.length} bytes)`);
}

for (const target of TARGETS) writeContractFile(target);
for (const target of VERIFICATION_TARGETS) writeVerificationInput(target);

console.log("\nDone. Review the diff, then commit — every future launch will deploy this exact bytecode.");
