/**
 * Merkle tree for InfoFi payouts.
 *
 * The leaf encoding here MUST match `InfoFiCampaign.claim` byte for byte:
 *
 *     keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 *
 * The inner hash is the leaf's own data; the outer hash is the standard
 * second-preimage defence. Without it, a 64-byte internal node could be
 * replayed as if it were a leaf, letting someone "prove" an allocation that
 * was never in the tree. Any drift between this file and the contract shows
 * up as every claim reverting with InvalidProof, so it is worth being exact.
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";

export type Leaf = {
  account: `0x${string}`;
  amountRaw: bigint;
};

/** `keccak256(keccak256(abi.encode(address,uint256)))`. */
export function hashLeaf(leaf: Leaf): Hex {
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [leaf.account, leaf.amountRaw]
  );
  return keccak256(keccak256(encoded));
}

/**
 * Hashes a pair of nodes the way OpenZeppelin's `MerkleProof` does:
 * sorted, so a proof does not need to carry left/right position bits.
 */
function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [lo, hi])
  );
}

export type MerkleTree = {
  root: Hex;
  /** Proof per leaf, keyed by lowercased account address. */
  proofs: Map<string, Hex[]>;
  leaves: Hex[];
};

/**
 * Builds the tree and every proof in one pass.
 *
 * An odd node at any level is promoted unchanged rather than paired with
 * itself. Duplicating it would create two identical children, which makes
 * the same proof valid for a leaf that is not actually in the tree.
 */
export function buildMerkleTree(leaves: Leaf[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("buildMerkleTree: refusing to build an empty tree");
  }

  // Sort by leaf hash so the tree — and therefore the root — is fully
  // determined by its contents, independent of input ordering.
  const hashed = leaves
    .map((leaf) => ({ account: leaf.account.toLowerCase(), hash: hashLeaf(leaf) }))
    .sort((a, b) => (a.hash.toLowerCase() < b.hash.toLowerCase() ? -1 : 1));

  const leafHashes = hashed.map((h) => h.hash);
  const proofs = new Map<string, Hex[]>(hashed.map((h) => [h.account, [] as Hex[]]));

  // Index of each account within the current level, updated as we ascend.
  let positions = new Map<string, number>(hashed.map((h, i) => [h.account, i]));
  let level = leafHashes;

  while (level.length > 1) {
    const next: Hex[] = [];
    const nextPositions = new Map<string, number>();

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : undefined;

      if (right === undefined) {
        // Odd one out: promote as-is.
        next.push(left);
      } else {
        next.push(hashPair(left, right));
      }

      const parentIndex = next.length - 1;
      for (const [account, pos] of positions) {
        if (pos === i) {
          if (right !== undefined) proofs.get(account)!.push(right);
          nextPositions.set(account, parentIndex);
        } else if (pos === i + 1) {
          proofs.get(account)!.push(left);
          nextPositions.set(account, parentIndex);
        }
      }
    }

    level = next;
    positions = nextPositions;
  }

  return { root: level[0], proofs, leaves: leafHashes };
}

/**
 * Local mirror of the contract's verification, so a bad tree is caught
 * before the root is ever published on-chain rather than after, when it is
 * immutable and the pool is already committed.
 */
export function verifyProof(root: Hex, leaf: Leaf, proof: Hex[]): boolean {
  let computed = hashLeaf(leaf);
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

export type { Hex };
