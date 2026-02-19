import { LayoutDashboard } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
      <div className="text-center">
        <LayoutDashboard className="mx-auto size-12 text-muted-foreground/50" />
        <h1 className="mt-4 text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-muted-foreground">Coming in Phase 3D</p>
      </div>
    </div>
  );
}
