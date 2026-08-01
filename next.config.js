/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "vgbujcuwptvheqijyjbe.supabase.co" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  webpack: (config, { webpack }) => {
    // ConnectKit -> wagmi's Coinbase "Base Account" connector statically
    // imports @coinbase/cdp-sdk, which in turn statically imports the
    // @x402/* payment-protocol packages as OPTIONAL peer deps (per its own
    // package.json). We never use Base Account's x402 payment features —
    // just ordinary wallet connect — so these are safe to fully ignore
    // rather than installed; without this, webpack fails the build trying
    // to resolve packages that are legitimately not meant to be present.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};

module.exports = nextConfig;
