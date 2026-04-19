import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { runVrksText } from "@/lib/vrks-cli";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return jsonError("Forbidden", 403);
  }

  const result = await runVrksText(["apply"]);
  if (!result.ok) {
    return jsonError(result.stderr || result.stdout || "Failed to apply rules", 500);
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "rules_apply",
  });

  return NextResponse.json({ ok: true, stdout: result.stdout });
}
