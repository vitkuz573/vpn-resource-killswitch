import { auth } from "@/auth";
import { hasRole, type Role } from "@/lib/auth/roles";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  return session;
}

export async function requireRole(role: Role) {
  const session = await requireSession();
  if (!session) {
    return null;
  }
  if (!hasRole(session.user.role, role)) {
    return false;
  }
  return session;
}
