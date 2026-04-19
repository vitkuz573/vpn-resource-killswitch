import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { runVrksJson, runVrksText } from "@/lib/vrks-cli";

const upsertSchema = z.object({
  name: z.string().trim().min(2).max(64),
  domains: z.array(z.string().trim().min(3)).min(1),
  requiredCountry: z.string().trim().max(64).optional(),
  requiredServer: z.string().trim().max(128).optional(),
  allowedCountries: z.array(z.string().trim().min(2).max(2)).default([]),
  blockedCountries: z.array(z.string().trim().min(2).max(2)).default([]),
  blockedContextKeywords: z.array(z.string().trim().min(2).max(64)).default([]),
  replace: z.boolean().default(true),
  runApply: z.boolean().default(true),
});

const deleteSchema = z.object({
  name: z.string().trim().min(2).max(64),
  runApply: z.boolean().default(true),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const resources = await runVrksJson<Array<Record<string, unknown>>>(["resource-list", "--json"]);
    return NextResponse.json({ resources });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to list resources", 500);
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

  let input: z.infer<typeof upsertSchema>;
  try {
    input = upsertSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid payload", 400);
  }

  const args = ["resource-add", "--name", input.name];
  for (const domain of input.domains) {
    args.push("--domain", domain);
  }
  if (input.requiredCountry) {
    args.push("--country", input.requiredCountry);
  }
  if (input.requiredServer) {
    args.push("--server", input.requiredServer);
  }
  for (const country of input.allowedCountries) {
    args.push("--allow-country", country);
  }
  for (const country of input.blockedCountries) {
    args.push("--block-country", country);
  }
  for (const keyword of input.blockedContextKeywords) {
    args.push("--block-context", keyword);
  }
  if (input.replace) {
    args.push("--replace");
  }

  const save = await runVrksText(args);
  if (!save.ok) {
    return jsonError(save.stderr || save.stdout || "Failed to save resource", 500);
  }

  let applyResult: { ok: boolean; stdout: string; stderr: string } | null = null;
  if (input.runApply) {
    const apply = await runVrksText(["apply"]);
    applyResult = { ok: apply.ok, stdout: apply.stdout, stderr: apply.stderr };
    if (!apply.ok) {
      return jsonError(apply.stderr || apply.stdout || "Resource saved, but apply failed", 500);
    }
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "resource_upsert",
    target: input.name,
    payload: {
      domains: input.domains,
      replace: input.replace,
      runApply: input.runApply,
    },
  });

  return NextResponse.json({
    ok: true,
    stdout: save.stdout,
    apply: applyResult,
  });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return jsonError("Forbidden", 403);
  }

  let input: z.infer<typeof deleteSchema>;
  try {
    const url = new URL(request.url);
    input = deleteSchema.parse({
      name: url.searchParams.get("name"),
      runApply: url.searchParams.get("runApply") !== "false",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid request", 400);
  }

  const remove = await runVrksText(["resource-remove", "--name", input.name]);
  if (!remove.ok) {
    return jsonError(remove.stderr || remove.stdout || "Failed to remove resource", 500);
  }

  let applyResult: { ok: boolean; stdout: string; stderr: string } | null = null;
  if (input.runApply) {
    const apply = await runVrksText(["apply"]);
    applyResult = { ok: apply.ok, stdout: apply.stdout, stderr: apply.stderr };
    if (!apply.ok) {
      return jsonError(apply.stderr || apply.stdout || "Resource removed, but apply failed", 500);
    }
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "resource_remove",
    target: input.name,
    payload: { runApply: input.runApply },
  });

  return NextResponse.json({ ok: true, stdout: remove.stdout, apply: applyResult });
}
