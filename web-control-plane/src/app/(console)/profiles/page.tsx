import { auth } from "@/auth";
import { ProfilesPageClient } from "@/components/control/profiles-page-client";

export default async function ProfilesPage() {
  const session = await auth();
  return <ProfilesPageClient userRole={session?.user?.role || "VIEWER"} />;
}
