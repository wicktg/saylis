import { createConfig, factory } from "ponder";
import { parseAbiItem } from "viem";
import { BondingCurveAbi } from "./abis/BondingCurve";
import { GraduationMigratorAbi } from "./abis/GraduationMigrator";
import { UniswapV3PoolAbi } from "./abis/UniswapV3Pool";
import addresses from "./addresses.generated.json";

/**
 * Robinhood Chain mainnet — same deployment this whole app targets. See
 * app/_lib/contracts/config.ts on the frontend side for the matching
 * addresses; GRADUATION_MIGRATOR_ADDRESS in particular must stay identical
 * on both sides or pool discovery below silently watches the wrong (or a
 * now-superseded) migrator.
 */
const GRADUATION_MIGRATOR_ADDRESS = "0xBe8e28EA67015a7CF82173B617BF3Dd6ec008e9D";

/**
 * Earliest block anything here needs to scan from. Deliberately the block
 * the FIRST protocol contract was deployed at on this chain, not 0 — see
 * chunkedLogs.ts's old doc comment on the frontend for what scanning from
 * genesis costs when it isn't necessary. Override via env for a fresh
 * environment pointed at a later cutoff.
 */
const START_BLOCK = process.env.INDEXER_START_BLOCK
  ? Number(process.env.INDEXER_START_BLOCK)
  : 25_667_000;

const MIGRATED_EVENT = parseAbiItem(
  "event Migrated(address indexed pool, uint256 indexed tokenId, uint128 liquidity)"
);

export default createConfig({
  database: {
    kind: "postgres",
    // Supabase's own Postgres connection string (Settings > Database >
    // Connection string > URI), NOT the NEXT_PUBLIC_SUPABASE_URL/anon-key
    // pair the rest of the app uses — those go through PostgREST, this
    // needs a real `postgres://` connection.
    connectionString: process.env.SUPABASE_DB_URL!,
  },

  chains: {
    robinhood: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL!,

      /**
       * Optional WebSocket endpoint. When set, new blocks are PUSHED here
       * instead of being waited for by the poll below, which is the
       * difference between a trade reaching the feed in a few hundred
       * milliseconds and reaching it on the next tick.
       *
       * This is the one place in the system where a chain socket belongs:
       * a single always-on process holding one subscription, rather than
       * every browser holding its own. The public node rejects WebSocket
       * upgrades, so this needs the Alchemy `wss://` URL — leave it unset
       * and everything still works, just on the polling path.
       */
      ws: process.env.PONDER_RPC_WS_URL,

      /**
       * Fallback cadence, and what runs if `ws` is unset. Ponder's default
       * is 1000ms, which was written for chains that mine every 12s; this
       * one mines every ~100ms, so a whole second of latency was being
       * added to a feed the rest of the stack now delivers in milliseconds.
       *
       * Affordable precisely because it is ONE process: the cost of polling
       * faster here is fixed, where the browser-side polling it replaced
       * multiplied by every open tab.
       */
      pollingInterval: 250,
    },
  },

  contracts: {
    /**
     * Every BondingCurve this app has ever deployed. No on-chain factory
     * exists for these — see scripts/generate-curve-addresses.mjs for why
     * this list comes from Supabase instead of a factory() source, and for
     * the real limitation that creates (a token launched after this
     * process started needs a restart to be picked up).
     */
    BondingCurve: {
      abi: BondingCurveAbi,
      chain: "robinhood",
      address: addresses.curveAddresses as `0x${string}`[],
      startBlock: START_BLOCK,
    },

    /**
     * Single fixed address — this one's real. `Migrated` is what lets the
     * pool below use Ponder's genuine factory() pattern.
     */
    GraduationMigrator: {
      abi: GraduationMigratorAbi,
      chain: "robinhood",
      address: GRADUATION_MIGRATOR_ADDRESS,
      startBlock: START_BLOCK,
    },

    /**
     * Every pool GraduationMigrator has ever seeded, discovered from its
     * OWN `Migrated` event rather than a maintained list — this is what a
     * real on-chain factory buys you: no restart, no Supabase round trip,
     * new pools are indexed automatically the moment they're created.
     */
    UniswapV3Pool: {
      abi: UniswapV3PoolAbi,
      chain: "robinhood",
      address: factory({
        address: GRADUATION_MIGRATOR_ADDRESS,
        event: MIGRATED_EVENT,
        parameter: "pool",
      }),
      startBlock: START_BLOCK,
    },
  },
});
