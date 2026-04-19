import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/http";
import { parseVrksResource } from "@/lib/resources";
import { runVrksJson } from "@/lib/vrks-cli";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const rawResources = await runVrksJson<Array<Record<string, unknown>>>(["resource-list", "--json"]);
    const resources = rawResources
      .map((raw) => parseVrksResource(raw))
      .map((item) => ({
        name: item.name,
        domains: item.domains,
        requiredCountry: item.policy.required_country || undefined,
        requiredServer: item.policy.required_server || undefined,
        allowedCountries: item.policy.allowed_countries,
        blockedCountries: item.policy.blocked_countries,
        blockedContextKeywords: item.policy.blocked_context_keywords,
      }));

    const payload = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      resources,
    };

    const fingerprint = createHash("sha256")
      .update(JSON.stringify(payload.resources))
      .digest("hex");

    return NextResponse.json({
      ...payload,
      fingerprint,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to export resources", 500);
  }
}
