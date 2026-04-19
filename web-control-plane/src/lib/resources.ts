import { z } from "zod";

const RESOURCE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;
const DOMAIN_REGEX = /^(?=.{3,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;

export type ResourcePolicyDto = {
  required_country: string | null;
  required_server: string | null;
  allowed_countries: string[];
  blocked_countries: string[];
  blocked_context_keywords: string[];
};

export type ResourceDto = {
  name: string;
  domains: string[];
  domainCount: number;
  policy: ResourcePolicyDto;
  hasPolicyConstraints: boolean;
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function cleanText(value: string | undefined | null): string {
  return (value || "").trim();
}

function normalizeDomain(value: string): string {
  const normalized = cleanText(value).toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    throw new Error("Domain cannot be empty");
  }
  if (normalized.includes("://")) {
    throw new Error(`Domain must not include scheme: ${value}`);
  }
  if (!DOMAIN_REGEX.test(normalized)) {
    throw new Error(`Invalid domain format: ${value}`);
  }
  return normalized;
}

function normalizeCountryCode(value: string): string {
  const normalized = cleanText(value).toUpperCase();
  if (!COUNTRY_CODE_REGEX.test(normalized)) {
    throw new Error(`Invalid country code: ${value}`);
  }
  return normalized;
}

function normalizeKeyword(value: string): string {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) {
    throw new Error("Keyword cannot be empty");
  }
  if (normalized.length < 2 || normalized.length > 64) {
    throw new Error(`Invalid keyword length: ${value}`);
  }
  return normalized;
}

function normalizeResourceName(value: string): string {
  const normalized = cleanText(value);
  if (!RESOURCE_NAME_REGEX.test(normalized)) {
    throw new Error(
      "Resource name must start with a letter/digit and contain only letters, digits, dot, underscore or hyphen",
    );
  }
  return normalized;
}

export const resourceUpsertSchema = z.object({
  name: z.string().trim().min(2).max(64),
  domains: z.array(z.string().trim().min(1).max(253)).min(1).max(2048),
  requiredCountry: z.string().trim().min(2).max(2).optional(),
  requiredServer: z.string().trim().min(1).max(128).optional(),
  allowedCountries: z.array(z.string().trim().min(2).max(2)).default([]),
  blockedCountries: z.array(z.string().trim().min(2).max(2)).default([]),
  blockedContextKeywords: z.array(z.string().trim().min(2).max(64)).default([]),
  replace: z.boolean().default(true),
  runApply: z.boolean().default(true),
  runVerify: z.boolean().default(false),
  verifyTimeout: z.number().int().min(3).max(60).default(8),
});

export type ResourceUpsertInput = z.infer<typeof resourceUpsertSchema>;

export type NormalizedResourceUpsertInput = {
  name: string;
  domains: string[];
  requiredCountry: string | undefined;
  requiredServer: string | undefined;
  allowedCountries: string[];
  blockedCountries: string[];
  blockedContextKeywords: string[];
  replace: boolean;
  runApply: boolean;
  runVerify: boolean;
  verifyTimeout: number;
};

export function normalizeResourceUpsertInput(input: ResourceUpsertInput): NormalizedResourceUpsertInput {
  const name = normalizeResourceName(input.name);
  const domains = uniqueSorted(input.domains.map((item) => normalizeDomain(item)));
  const requiredCountry = input.requiredCountry ? normalizeCountryCode(input.requiredCountry) : undefined;
  const requiredServer = input.requiredServer ? cleanText(input.requiredServer) : undefined;
  const allowedCountries = uniqueSorted(input.allowedCountries.map((item) => normalizeCountryCode(item)));
  const blockedCountries = uniqueSorted(input.blockedCountries.map((item) => normalizeCountryCode(item)));
  const blockedContextKeywords = uniqueSorted(
    input.blockedContextKeywords.map((item) => normalizeKeyword(item)),
  );

  const overlap = allowedCountries.filter((item) => blockedCountries.includes(item));
  if (overlap.length > 0) {
    throw new Error(`Countries cannot be both allowed and blocked: ${overlap.join(", ")}`);
  }

  return {
    name,
    domains,
    requiredCountry,
    requiredServer,
    allowedCountries,
    blockedCountries,
    blockedContextKeywords,
    replace: input.replace,
    runApply: input.runApply,
    runVerify: input.runVerify,
    verifyTimeout: input.verifyTimeout,
  };
}

export function buildResourceAddArgs(input: NormalizedResourceUpsertInput): string[] {
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
  return args;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanText(typeof item === "string" ? item : String(item ?? "")))
    .filter(Boolean);
}

function toOptionalString(value: unknown): string | null {
  const normalized = cleanText(typeof value === "string" ? value : String(value ?? ""));
  return normalized || null;
}

export function parseVrksResource(raw: Record<string, unknown>): ResourceDto {
  const policyRaw = (raw.policy as Record<string, unknown> | undefined) || {};
  const policy: ResourcePolicyDto = {
    required_country: toOptionalString(policyRaw.required_country),
    required_server: toOptionalString(policyRaw.required_server),
    allowed_countries: uniqueSorted(toStringArray(policyRaw.allowed_countries).map((item) => item.toUpperCase())),
    blocked_countries: uniqueSorted(toStringArray(policyRaw.blocked_countries).map((item) => item.toUpperCase())),
    blocked_context_keywords: uniqueSorted(
      toStringArray(policyRaw.blocked_context_keywords).map((item) => item.toLowerCase()),
    ),
  };

  const domains = uniqueSorted(toStringArray(raw.domains).map((item) => item.toLowerCase()));
  const name = cleanText(typeof raw.name === "string" ? raw.name : String(raw.name ?? ""));

  const hasPolicyConstraints =
    Boolean(policy.required_country) ||
    Boolean(policy.required_server) ||
    policy.allowed_countries.length > 0 ||
    policy.blocked_countries.length > 0 ||
    policy.blocked_context_keywords.length > 0;

  return {
    name,
    domains,
    domainCount: domains.length,
    policy,
    hasPolicyConstraints,
  };
}

export const resourceListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  sort: z
    .enum(["name_asc", "name_desc", "domains_asc", "domains_desc"])
    .optional()
    .default("name_asc"),
  policy: z.enum(["all", "restricted", "open"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
});

export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export function filterAndSortResources(resources: ResourceDto[], query: ResourceListQuery): ResourceDto[] {
  const needle = query.q.toLowerCase();
  let filtered = resources.filter((resource) => {
    if (query.policy === "restricted" && !resource.hasPolicyConstraints) {
      return false;
    }
    if (query.policy === "open" && resource.hasPolicyConstraints) {
      return false;
    }
    if (!needle) {
      return true;
    }
    if (resource.name.toLowerCase().includes(needle)) {
      return true;
    }
    return resource.domains.some((domain) => domain.includes(needle));
  });

  filtered = [...filtered].sort((left, right) => {
    if (query.sort === "domains_asc") {
      return left.domainCount - right.domainCount || left.name.localeCompare(right.name);
    }
    if (query.sort === "domains_desc") {
      return right.domainCount - left.domainCount || left.name.localeCompare(right.name);
    }
    if (query.sort === "name_desc") {
      return right.name.localeCompare(left.name);
    }
    return left.name.localeCompare(right.name);
  });

  return filtered;
}

export function paginateResources(resources: ResourceDto[], page: number, pageSize: number) {
  const total = resources.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const items = resources.slice(offset, offset + pageSize);

  return {
    items,
    meta: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
}

export function policySummary(policy: ResourcePolicyDto): string {
  const chunks: string[] = [];
  if (policy.required_country) {
    chunks.push(`country=${policy.required_country}`);
  }
  if (policy.required_server) {
    chunks.push(`server~=${policy.required_server}`);
  }
  if (policy.allowed_countries.length > 0) {
    chunks.push(`allow=${policy.allowed_countries.join("/")}`);
  }
  if (policy.blocked_countries.length > 0) {
    chunks.push(`block=${policy.blocked_countries.join("/")}`);
  }
  if (policy.blocked_context_keywords.length > 0) {
    chunks.push(`ctx=${policy.blocked_context_keywords.join("/")}`);
  }
  return chunks.join(" | ") || "no policy constraints";
}
