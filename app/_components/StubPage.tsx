import AppShell from "@/app/_components/AppShell";

export default function StubPage({ title }: { title: string }) {
  return (
    <AppShell>
      <div className="flex-1 grid place-items-center px-[var(--gutter)] py-24">
        <div className="text-center">
          <h1 className="font-display text-[clamp(1.375rem,2.6vw,1.875rem)] text-[#2e2e2e] m-0">
            {title}
          </h1>
          <p className="mt-2 text-[0.875rem] font-medium text-[var(--ink-soft)]">Coming soon.</p>
        </div>
      </div>
    </AppShell>
  );
}
