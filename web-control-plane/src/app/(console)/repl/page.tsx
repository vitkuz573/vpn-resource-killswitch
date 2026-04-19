import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ReplPageClient } from "@/components/control/repl-page-client";
import { hasRole } from "@/lib/auth/roles";

export default async function ReplPage() {
  const session = await auth();
  const role = session?.user?.role || "VIEWER";
  if (!hasRole(role, "OPERATOR")) {
    redirect("/overview");
  }
  return <ReplPageClient userRole={role} />;
}
