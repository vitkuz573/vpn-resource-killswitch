import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import {
  buildResourceAddArgs,
  filterAndSortResources,
  normalizeResourceUpsertInput,
  paginateResources,
  parseVrksResource,
  resourceListQuerySchema,
  resourceUpsertSchema,
} from "@/lib/resources";
import { runVrksJson, runVrksText } from "@/lib/vrks-cli";

const deleteSchema = z.object({
  name: z.string().trim().min(2).max(64),
  runApply: z.boolean().default(true),
  runVerify: z.boolean().default(false),
  verifyTimeout: z.number().int().min(3).max(60).default(8),
});

function parseBoolean(value: string | null | undefined, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(request.url);
  const parsedQuery = resourceListQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    policy: url.searchParams.get("policy") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });

  if (!parsedQuery.success) {
    return jsonError(parsedQuery.error.issues.map((item) => item.message).join(", "), 400);
  }

  try {
    const rawResources = await runVrksJson<Array<Record<string, unknown>>>(["resource-list", "--json"]);
    const allResources = rawResources.map((raw) => parseVrksResource(raw));
    const filtered = filterAndSortResources(allResources, parsedQuery.data);
    const paged = paginateResources(filtered, parsedQuery.data.page, parsedQuery.data.pageSize);

    return NextResponse.json({
      resources: paged.items,
      items: paged.items,
      meta: {
        ...paged.meta,
        totalAll: allResources.length,
        q: parsedQuery.data.q,
        sort: parsedQuery.data.sort,
        policy: parsedQuery.data.policy,
      },
    });
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

  const rawBody = await request.json().catch(() => null);
  const parsed = resourceUpsertSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }

  let input: ReturnType<typeof normalizeResourceUpsertInput>;
  try {
    input = normalizeResourceUpsertInput(parsed.data);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid resource payload", 400);
  }

  const save = await runVrksText(buildResourceAddArgs(input));
  if (!save.ok) {
    return jsonError(save.stderr || save.stdout || "Failed to save resource", 500);
  }

  let applyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (input.runApply) {
    const apply = await runVrksText(["apply"]);
    applyResult = {
      ok: apply.ok,
      code: apply.code,
      stdout: apply.stdout,
      stderr: apply.stderr,
    };
    if (!apply.ok) {
      return jsonError(apply.stderr || apply.stdout || "Resource saved, but apply failed", 500);
    }
  }

  let verifyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (input.runVerify) {
    const verify = await runVrksText(["verify", "--timeout", String(input.verifyTimeout)], 90_000);
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
    action: "resource_upsert",
    target: input.name,
    payload: {
      domains: input.domains,
      replace: input.replace,
      runApply: input.runApply,
      runVerify: input.runVerify,
      verifyTimeout: input.verifyTimeout,
    },
  });

  return NextResponse.json({
    ok: !verifyResult || verifyResult.ok,
    resource: {
      name: input.name,
      domains: input.domains,
      policy: {
        required_country: input.requiredCountry || null,
        required_server: input.requiredServer || null,
        allowed_countries: input.allowedCountries,
        blocked_countries: input.blockedCountries,
        blocked_context_keywords: input.blockedContextKeywords,
      },
    },
    stdout: save.stdout,
    apply: applyResult,
    verify: verifyResult,
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

  const url = new URL(request.url);
  const parsed = deleteSchema.safeParse({
    name: url.searchParams.get("name") ?? undefined,
    runApply: parseBoolean(url.searchParams.get("runApply"), true),
    runVerify: parseBoolean(url.searchParams.get("runVerify"), false),
    verifyTimeout: url.searchParams.get("verifyTimeout")
      ? Number(url.searchParams.get("verifyTimeout"))
      : 8,
  });

  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }

  const input = parsed.data;

  const remove = await runVrksText(["resource-remove", "--name", input.name]);
  if (!remove.ok) {
    return jsonError(remove.stderr || remove.stdout || "Failed to remove resource", 500);
  }

  let applyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (input.runApply) {
    const apply = await runVrksText(["apply"]);
    applyResult = {
      ok: apply.ok,
      code: apply.code,
      stdout: apply.stdout,
      stderr: apply.stderr,
    };
    if (!apply.ok) {
      return jsonError(apply.stderr || apply.stdout || "Resource removed, but apply failed", 500);
    }
  }

  let verifyResult: { ok: boolean; code: number; stdout: string; stderr: string } | null = null;
  if (input.runVerify) {
    const verify = await runVrksText(["verify", "--timeout", String(input.verifyTimeout)], 90_000);
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
    action: "resource_remove",
    target: input.name,
    payload: {
      runApply: input.runApply,
      runVerify: input.runVerify,
      verifyTimeout: input.verifyTimeout,
    },
  });

  return NextResponse.json({
    ok: !verifyResult || verifyResult.ok,
    stdout: remove.stdout,
    apply: applyResult,
    verify: verifyResult,
  });
}
