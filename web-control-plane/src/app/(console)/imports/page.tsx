import { auth } from "@/auth";
import { ImportsPageClient } from "@/components/control/imports-page-client";

export default async function ImportsPage() {
  const session = await auth();
  return <ImportsPageClient userRole={session?.user?.role || "VIEWER"} />;
}
