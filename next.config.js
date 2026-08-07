/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Strip every console.* call from the production bundle.
   *
   * These were never for users: they name wallet addresses, contract
   * addresses, API paths and response bodies, and anyone with devtools open
   * reads all of it. Removing them at build time means there is nothing to
   * forget to delete, and nothing survives minification to be found later.
   *
   * Development is untouched — Next only applies this to production builds,
   * which is where the logs are a disclosure rather than a tool.
   */
  compiler: {
    removeConsole: true,
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "vgbujcuwptvheqijyjbe.supabase.co" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
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
