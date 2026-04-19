import type { paths } from "@/lib/api/generated";

type GetAccountResponse = paths["/api/auth/account"]["get"]["responses"][200]["content"]["application/json"];
type PatchAccountBody = paths["/api/auth/account"]["patch"]["requestBody"]["content"]["application/json"];
type PatchAccountResponse = paths["/api/auth/account"]["patch"]["responses"][200]["content"]["application/json"];

type PostPasswordBody = paths["/api/auth/account/password"]["post"]["requestBody"]["content"]["application/json"];
type PostPasswordResponse = paths["/api/auth/account/password"]["post"]["responses"][200]["content"]["application/json"];

type GetSessionsResponse = paths["/api/auth/account/sessions"]["get"]["responses"][200]["content"]["application/json"];
type PostSessionsBody = paths["/api/auth/account/sessions"]["post"]["requestBody"]["content"]["application/json"];
type PostSessionsResponse = paths["/api/auth/account/sessions"]["post"]["responses"][200]["content"]["application/json"];

type GetAuditQuery = NonNullable<paths["/api/audit/logs"]["get"]["parameters"]["query"]>;
type GetAuditResponse = paths["/api/audit/logs"]["get"]["responses"][200]["content"]["application/json"];

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

export async function apiGetAccount(): Promise<GetAccountResponse> {
  return fetchJson<GetAccountResponse>("/api/auth/account", { cache: "no-store" });
}

export async function apiPatchAccount(body: PatchAccountBody): Promise<PatchAccountResponse> {
  return fetchJson<PatchAccountResponse>("/api/auth/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiPostAccountPassword(body: PostPasswordBody): Promise<PostPasswordResponse> {
  return fetchJson<PostPasswordResponse>("/api/auth/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiGetAccountSessions(): Promise<GetSessionsResponse> {
  return fetchJson<GetSessionsResponse>("/api/auth/account/sessions", { cache: "no-store" });
}

export async function apiPostAccountSessions(body: PostSessionsBody): Promise<PostSessionsResponse> {
  return fetchJson<PostSessionsResponse>("/api/auth/account/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function apiGetAuditLogs(query: Omit<GetAuditQuery, "export">): Promise<GetAuditResponse> {
  const suffix = buildQuery({
    q: query.q,
    actor: query.actor,
    action: query.action,
    target: query.target,
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
  });
  return fetchJson<GetAuditResponse>(`/api/audit/logs${suffix}`, { cache: "no-store" });
}

export async function apiExportAuditLogs(query: Omit<GetAuditQuery, "export">): Promise<GetAuditResponse> {
  const suffix = buildQuery({
    ...query,
    export: "1",
  });
  return fetchJson<GetAuditResponse>(`/api/audit/logs${suffix}`, { cache: "no-store" });
}
