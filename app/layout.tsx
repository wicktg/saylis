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
      <body className="selection:bg-[var(--accent)]/30">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
