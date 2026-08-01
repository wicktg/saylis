export type DocPage = { slug: string; title: string };
export type DocCategory = { title: string; pages: DocPage[] };

export const DOCS_NAV: DocCategory[] = [
  {
    title: "For Traders",
    pages: [
      { slug: "overview", title: "What Saylis Is" },
      { slug: "bonding-curve", title: "How the Bonding Curve Works" },
      { slug: "anti-snipe-max-wallet", title: "Anti-Snipe & Max-Wallet Cap" },
      { slug: "whale-tax-tiers", title: "Whale Sell Tax Tiers" },
      { slug: "graduation", title: "Graduation" },
      { slug: "reading-token-page", title: "How to Read a Token Page" },
    ],
  },
  {
    title: "For Creators",
    pages: [
      { slug: "launching-a-token", title: "Launching a Token" },
      { slug: "fee-structure", title: "Fee Structure" },
      { slug: "graduation-bonus", title: "Graduation Bonus" },
      { slug: "whale-tax-creator", title: "Whale Tax, for Creators" },
      { slug: "fee-redirect", title: "Redirecting Your Fees" },
      { slug: "infofi-campaigns", title: "InfoFi Campaigns" },
      { slug: "referral-program", title: "Referral Program" },
    ],
  },
  {
    title: "For Campaign Participants",
    pages: [
      { slug: "joining-a-campaign", title: "Joining a Campaign" },
      { slug: "valid-contributions", title: "Valid Contributions" },
      { slug: "mindshare-calculation", title: "How Mindshare Is Calculated" },
      { slug: "leaderboard-updates", title: "Leaderboard Updates" },
      { slug: "claiming-rewards", title: "Claiming Rewards" },
    ],
  },
  {
    title: "Trust & Safety",
    pages: [
      { slug: "full-disclosure", title: "Full Disclosure Principle" },
      { slug: "lp-lock", title: "LP Lock" },
      { slug: "immutable-contracts", title: "Immutable Contracts" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { slug: "contract-addresses", title: "Contract Addresses" },
      { slug: "faq", title: "FAQ" },
    ],
  },
];

export function findDocPage(slug: string): { title: string; category: string } | null {
  for (const category of DOCS_NAV) {
    const page = category.pages.find((p) => p.slug === slug);
    if (page) return { title: page.title, category: category.title };
  }
  return null;
}

export function flatPages(): DocPage[] {
  return DOCS_NAV.flatMap((c) => c.pages);
}
