import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import {
  buildResourceAddArgs,
  normalizeResourceUpsertInput,
  parseVrksResource,
  policySummary,
  resourceUpsertSchema,
} from "@/lib/resources";
import { runVrksJson, runVrksText } from "@/lib/vrks-cli";

const resourceImportItemSchema = resourceUpsertSchema.pick({
  name: true,
  domains: true,
  requiredCountry: true,
  requiredServer: true,
  allowedCountries: true,
  blockedCountries: true,
  blockedContextKeywords: true,
  replace: true,
});

const importSchema = z.object({
  resources: z.array(resourceImportItemSchema).min(1).max(1000),
  mode: z.enum(["merge", "replace_all"]).default("merge"),
  runApply: z.boolean().default(true),
  runVerify: z.boolean().default(false),
  verifyTimeout: z.number().int().min(3).max(60).default(8),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return jsonError("Forbidden", 403);
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }

  const normalizedResources: Array<ReturnType<typeof normalizeResourceUpsertInput>> = [];
  try {
    for (const item of parsed.data.resources) {
      normalizedResources.push(
        normalizeResourceUpsertInput({
          ...item,
          runApply: false,
          runVerify: false,
          verifyTimeout: 8,
        }),
      );
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid resources payload", 400);
  }

  const names = normalizedResources.map((item) => item.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    return jsonError(`Duplicate resource names in import payload: ${Array.from(new Set(duplicates)).join(", ")}`, 400);
  }

  const beforeRaw = await runVrksJson<Array<Record<string, unknown>>>(["resource-list", "--json"]);
  const beforeResources = beforeRaw.map((raw) => parseVrksResource(raw));
  const beforeNames = new Set(beforeResources.map((item) => item.name));

  const upserted: string[] = [];
  for (const item of normalizedResources) {
    const upsert = await runVrksText(buildResourceAddArgs(item));
    if (!upsert.ok) {
      return jsonError(
        `Import failed on resource '${item.name}': ${upsert.stderr || upsert.stdout || "unknown error"}`,
        500,
      );
    }
    upserted.push(item.name);
  }

  const removed: string[] = [];
  if (parsed.data.mode === "replace_all") {
    const keepNames = new Set(normalizedResources.map((item) => item.name));
    for (const existingName of beforeNames) {
      if (keepNames.has(existingName)) {
        continue;
      }
      const remove = await runVrksText(["resource-remove", "--name", existingName]);
      if (!remove.ok) {
        return jsonError(
          `Import replace_all failed while removing '${existingName}': ${remove.stderr || remove.stdout || "unknown error"}`,
          500,
        );
      }
      removed.push(existingName);
    }
  }

  let applyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (parsed.data.runApply) {
    const apply = await runVrksText(["apply"]);
    applyResult = {
      ok: apply.ok,
      code: apply.code,
      stdout: apply.stdout,
      stderr: apply.stderr,
    };
    if (!apply.ok) {
      return jsonError(apply.stderr || apply.stdout || "Resources imported, but apply failed", 500);
    }
  }

  let verifyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (parsed.data.runVerify) {
    const verify = await runVrksText(["verify", "--timeout", String(parsed.data.verifyTimeout)], 90_000);
    verifyResult = {
      ok: verify.ok,
      code: verify.code,
      stdout: verify.stdout,
      stderr: verify.stderr,
    };
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "resource_import",
    target: `count:${normalizedResources.length}`,
    payload: {
      mode: parsed.data.mode,
      upserted,
      removed,
      runApply: parsed.data.runApply,
      runVerify: parsed.data.runVerify,
      verifyTimeout: parsed.data.verifyTimeout,
    },
  });

  return NextResponse.json({
    ok: !verifyResult || verifyResult.ok,
    mode: parsed.data.mode,
    counts: {
      input: normalizedResources.length,
      upserted: upserted.length,
      removed: removed.length,
      createdApprox: upserted.filter((name) => !beforeNames.has(name)).length,
      updatedApprox: upserted.filter((name) => beforeNames.has(name)).length,
    },
    upserted,
    removed,
    resources: normalizedResources.map((item) => ({
      name: item.name,
      domains: item.domains,
      policySummary: policySummary({
        required_country: item.requiredCountry || null,
        required_server: item.requiredServer || null,
        allowed_countries: item.allowedCountries,
        blocked_countries: item.blockedCountries,
        blocked_context_keywords: item.blockedContextKeywords,
      }),
    })),
    apply: applyResult,
    verify: verifyResult,
  });
}
