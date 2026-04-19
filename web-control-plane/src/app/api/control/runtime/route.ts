import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { runVrksText } from "@/lib/vrks-cli";

const runtimeManageSchema = z.object({
  operation: z.literal("manage_unit"),
  unit: z.enum(["timer", "watch", "blockpage", "blockpage-tls", "all"]),
  action: z.enum(["start", "stop", "restart", "enable", "disable", "enable-now", "disable-now"]),
});

const disableRulesSchema = z.object({
  operation: z.literal("disable_rules"),
});

const teardownSchema = z.object({
  operation: z.literal("teardown"),
  purge: z.boolean().default(false),
  removeBin: z.boolean().default(false),
});

const runtimeOperationSchema = z.union([runtimeManageSchema, disableRulesSchema, teardownSchema]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return jsonError("Forbidden", 403);
  }

  const payloadRaw = await request.json().catch(() => null);
  const parsed = runtimeOperationSchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }

  const payload = parsed.data;
  let result;
  let target = "";
  let action: string = payload.operation;

  if (payload.operation === "manage_unit") {
    result = await runVrksText([
      "runtime-manage",
      "--unit",
      payload.unit,
      "--action",
      payload.action,
    ]);
    target = payload.unit;
    action = `runtime_manage_${payload.action}`;
  } else if (payload.operation === "disable_rules") {
    result = await runVrksText(["disable"]);
    target = "nft";
    action = "runtime_disable_rules";
  } else {
    const args = ["teardown"];
    if (payload.purge) {
      args.push("--purge");
    }
    if (payload.removeBin) {
      args.push("--remove-bin");
    }
    result = await runVrksText(args);
    target = "runtime";
    action = "runtime_teardown";
  }

  if (!result.ok) {
    return jsonError(result.stderr || result.stdout || "Runtime operation failed", 500);
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action,
    target,
    payload,
  });

  return NextResponse.json({
    ok: true,
    operation: payload.operation,
    stdout: result.stdout,
  });
}
