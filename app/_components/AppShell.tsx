import Sidebar from "@/app/_components/Sidebar";
import TopNav from "@/app/_components/TopNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-[1] flex flex-col h-screen w-full text-sm">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
