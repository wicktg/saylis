import type { Metadata } from "next";
import DocsSidebar from "./_components/DocsSidebar";
import DocsTopBar from "./_components/DocsTopBar";

export const metadata: Metadata = {
  title: "Docs - Saylis",
  description: "Saylis documentation.",
};

/**
 * Deliberately isolated from the rest of the app — no TopNav, no chat
 * sidebar, no wallet/balance/profile chrome. Just the logo (top bar) and a
 * GitBook-style docs sidebar + content column, matching how /admin already
 * opts out of AppShell for the same reason: this is a standalone surface.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-full flex flex-col bg-black text-white text-sm">
      <DocsTopBar />
      <div className="flex-1 flex overflow-hidden">
        <DocsSidebar />
        <main className="flex-1 overflow-y-auto pixel-scrollbar">
          <div className="max-w-3xl mx-auto px-8 py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
