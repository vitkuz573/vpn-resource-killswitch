import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ConsoleNav } from "@/components/console-nav";
import { Topbar } from "@/components/topbar";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const role = session.user.role || "VIEWER";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Topbar
        name={session.user.name || "User"}
        email={session.user.email || "unknown"}
        role={role}
      />
      <ConsoleNav role={role} />
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-6">{children}</div>
    </div>
  );
}
