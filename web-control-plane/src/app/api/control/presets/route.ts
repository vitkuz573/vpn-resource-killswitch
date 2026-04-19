import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { runVrksJson, runVrksText } from "@/lib/vrks-cli";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const presets = await runVrksJson<Array<Record<string, unknown>>>(["preset-list", "--json"]);
    return NextResponse.json({ presets });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to list presets", 500);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return jsonError("Forbidden", 403);
  }

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = (body?.name || "").trim();
  if (!name) {
    return jsonError("Preset name is required", 400);
  }

  const result = await runVrksText(["preset-apply", "--name", name, "--replace"]);
  if (!result.ok) {
    return jsonError(result.stderr || result.stdout || "Failed to apply preset", 500);
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "preset_apply",
    target: name,
  });

  return NextResponse.json({ ok: true, stdout: result.stdout });
}
