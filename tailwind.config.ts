import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-main": "#1a0c6d",
        "bg-card": "#1a0c6d",
        "bg-sidebar": "#1a0c6d",
        "accent-lime": "#ffffff",
        "text-muted": "#a8a3c9",
        // Monochrome accent scale — replaces the old lime-green branding.
        // Kept under the `lime` key so every existing `lime-*` utility
        // class in the app (buttons, active states, focus rings) resolves
        // to white/gray instead of touching dozens of files individually.
        lime: {
          300: "#ffffff",
          400: "#ffffff",
          500: "#d4d4d4",
        },
      },
      fontFamily: {
        satoshi: ["Satoshi", "Inter", "sans-serif"],
        // Reserved for numeric data (market cap, volume, etc.) — set via
        // next/font in app/layout.tsx as --font-jetbrains-mono.
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
