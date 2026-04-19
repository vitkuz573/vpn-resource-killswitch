import { auth } from "@/auth";
import { PresetsPageClient } from "@/components/control/presets-page-client";

export default async function PresetsPage() {
  const session = await auth();
  return <PresetsPageClient userRole={session?.user?.role || "VIEWER"} />;
}
