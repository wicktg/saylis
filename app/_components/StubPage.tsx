import AppShell from "@/app/_components/AppShell";

export default function StubPage({ title }: { title: string }) {
  return (
    <AppShell>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{title}</h1>
          <p className="text-white/40 text-sm">Coming soon.</p>
        </div>
      </div>
    </AppShell>
  );
}
