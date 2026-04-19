export type ResourcePolicy = {
  required_country?: string | null;
  required_server?: string | null;
  allowed_countries?: string[];
  blocked_countries?: string[];
  blocked_context_keywords?: string[];
};

export async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function splitLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export function policySummary(policy?: ResourcePolicy): string {
  if (!policy) {
    return "no policy constraints";
  }

  const chunks: string[] = [];
  if (policy.required_country) {
    chunks.push(`country=${policy.required_country}`);
  }
  if (policy.required_server) {
    chunks.push(`server~=${policy.required_server}`);
  }
  if ((policy.allowed_countries || []).length > 0) {
    chunks.push(`allow=${(policy.allowed_countries || []).join("/")}`);
  }
  if ((policy.blocked_countries || []).length > 0) {
    chunks.push(`block=${(policy.blocked_countries || []).join("/")}`);
  }
  if ((policy.blocked_context_keywords || []).length > 0) {
    chunks.push(`ctx=${(policy.blocked_context_keywords || []).join("/")}`);
  }
  return chunks.join(" | ") || "no policy constraints";
}

export function downloadJson(filename: string, payload: unknown): void {
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
