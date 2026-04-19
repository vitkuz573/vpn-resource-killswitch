import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { DashboardClient } from "@/components/dashboard-client";
import { Topbar } from "@/components/topbar";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Topbar
        name={session.user.name || "User"}
        email={session.user.email || "unknown"}
        role={session.user.role || "VIEWER"}
      />
      <DashboardClient userRole={session.user.role || "VIEWER"} />
    </div>
  );
}
