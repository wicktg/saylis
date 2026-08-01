export type TokenSocials = {
  x?: string;
  telegram?: string;
  website?: string;
};

/** Row shape of the public.tokens table — see supabase/schema.sql. */
export type TokenRecord = {
  id: string;
  contract_address: string;
  curve_address: string;
  creator_wallet_address: string;
  name: string;
  ticker: string;
  description: string | null;
  socials: TokenSocials;
  /** ipfs:// URI, or null if no image was uploaded. Resolve for display via resolveIpfsUrl(). */
  image_url: string | null;
  created_at: string;
};
