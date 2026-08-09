import type { Metadata } from "next";
import DocsSidebar from "./_components/DocsSidebar";
import DocsTopBar from "./_components/DocsTopBar";

export const metadata: Metadata = {
  title: "Docs - Saylis",
  description: "Saylis documentation.",
};

/**
 * Deliberately isolated from the rest of the app — no header pill, no
 * wallet chrome, no board — this is a standalone reading surface: a slim
 * top bar, a category sidebar, and a single content column. Same reasoning
 * `/admin` uses to opt out of `AppShell`, applied to a very different kind
 * of page.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-full flex flex-col bg-[var(--surface)] text-[var(--ink)] text-sm">
      <DocsTopBar />
      <div className="flex-1 flex overflow-hidden">
        <DocsSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[42rem] mx-auto px-6 md:px-10 py-12">{children}</div>
        </main>
      </div>
    </div>
  );
}
