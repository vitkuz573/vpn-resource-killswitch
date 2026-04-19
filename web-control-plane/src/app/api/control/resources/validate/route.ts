import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { jsonError } from "@/lib/http";
import { normalizeResourceUpsertInput, policySummary, resourceUpsertSchema } from "@/lib/resources";

const resourceValidateItemSchema = resourceUpsertSchema.pick({
  name: true,
  domains: true,
  requiredCountry: true,
  requiredServer: true,
  allowedCountries: true,
  blockedCountries: true,
  blockedContextKeywords: true,
  replace: true,
});

const validateSchema = z
  .object({
    resource: resourceValidateItemSchema.optional(),
    resources: z.array(resourceValidateItemSchema).max(1000).optional(),
  })
  .refine((data) => (data.resource ? 1 : 0) + (data.resources ? data.resources.length : 0) > 0, {
    message: "Provide `resource` or `resources`.",
  });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = validateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }

  const sourceItems = parsed.data.resources || (parsed.data.resource ? [parsed.data.resource] : []);
  const normalized: Array<ReturnType<typeof normalizeResourceUpsertInput>> = [];
  try {
    for (const item of sourceItems) {
      normalized.push(
        normalizeResourceUpsertInput({
          ...item,
          runApply: false,
          runVerify: false,
          verifyTimeout: 8,
        }),
      );
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Validation failed", 400);
  }

  const duplicateNames = normalized
    .map((item) => item.name)
    .filter((name, index, array) => array.indexOf(name) !== index);

  const warnings: string[] = [];
  if (duplicateNames.length > 0) {
    warnings.push(`Duplicate names: ${Array.from(new Set(duplicateNames)).join(", ")}`);
  }

  return NextResponse.json({
    ok: warnings.length === 0,
    warnings,
    count: normalized.length,
    resources: normalized.map((item) => ({
      name: item.name,
      domains: item.domains,
      domainCount: item.domains.length,
      policy: {
        required_country: item.requiredCountry || null,
        required_server: item.requiredServer || null,
        allowed_countries: item.allowedCountries,
        blocked_countries: item.blockedCountries,
        blocked_context_keywords: item.blockedContextKeywords,
      },
      policySummary: policySummary({
        required_country: item.requiredCountry || null,
        required_server: item.requiredServer || null,
        allowed_countries: item.allowedCountries,
        blocked_countries: item.blockedCountries,
        blocked_context_keywords: item.blockedContextKeywords,
      }),
    })),
  });
}
