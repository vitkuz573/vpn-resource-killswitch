import { auth } from "@/auth";
import { AuditPageClient } from "@/components/control/audit-page-client";

export default async function AuditPage() {
  const session = await auth();
  return <AuditPageClient userRole={session?.user?.role || "VIEWER"} />;
}
