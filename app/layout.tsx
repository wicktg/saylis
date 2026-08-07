import type { Metadata } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import Web3Provider from "@/app/_providers/Web3Provider";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Saylis",
  description: "Explore, launch, and trade tokens on saylis.wtf",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      {/* The iconify icon-font script used to load here. Every icon is now
          an ASCII text token rendered by app/_components/Icon.tsx, so the
          third-party script (and its render-blocking beforeInteractive
          fetch) is gone entirely. */}
      <head>
        {/*
          Silence third-party console output in production.

          `compiler.removeConsole` in next.config.js deletes OUR console
          calls at build time, but it cannot touch code inside node_modules
          — and the noisiest output is not ours: WalletConnect announces
          re-initialisation, wagmi and viem log connector and transport
          detail, and several libraries print request URLs. Anyone with
          devtools open reads all of it.

          Inline and in <head>, so it runs before any page or library code
          and there is no window in which something logs first. A module
          would be evaluated after whatever the bundler ordered ahead of it.

          Methods are replaced with no-ops rather than deleted, so a library
          calling one still finds a function and does not throw. Not applied
          in development, where these messages are the fastest way to
          understand a wallet or RPC problem.
        */}
        {process.env.NODE_ENV === "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "(function(){try{var n=function(){};" +
                "['log','debug','info','warn','error','trace','dir','table'," +
                "'group','groupCollapsed','groupEnd','time','timeEnd','count','assert']" +
                ".forEach(function(k){if(typeof console[k]==='function'){console[k]=n;}});" +
                "}catch(e){}})();",
            }}
          />
        )}
      </head>
      <body className="selection:bg-[var(--accent)]/30">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
