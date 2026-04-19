"use client";

import { useEffect, useMemo, useState } from "react";

type ResourcePolicy = {
  required_country?: string | null;
  required_server?: string | null;
  allowed_countries?: string[];
  blocked_countries?: string[];
  blocked_context_keywords?: string[];
};

type ResourceItem = {
  name: string;
  domains: string[];
  policy?: ResourcePolicy;
};

type Preset = {
  name: string;
  description: string;
  domains: string[];
};

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
};

type Props = {
  userRole: string;
};

function splitLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function parseResponse(response: Response): Promise<unknown> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export function DashboardClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [output, setOutput] = useState<string>("");

  const isOperator = userRole === "ADMIN" || userRole === "OPERATOR";
  const isAdmin = userRole === "ADMIN";

  const [resourceName, setResourceName] = useState("");
  const [resourceDomains, setResourceDomains] = useState("");
  const [resourceCountry, setResourceCountry] = useState("");
  const [resourceServer, setResourceServer] = useState("");
  const [allowCountries, setAllowCountries] = useState("");
  const [blockCountries, setBlockCountries] = useState("");
  const [blockContext, setBlockContext] = useState("");
  const [replaceMode, setReplaceMode] = useState(true);

  const [presetName, setPresetName] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPassword2, setNewUserPassword2] = useState("");
  const [newUserRole, setNewUserRole] = useState("VIEWER");

  async function refreshStatus(): Promise<void> {
    const response = await fetch("/api/control/status", { cache: "no-store" });
    const data = (await parseResponse(response)) as { status: Record<string, unknown> };
    setStatus(data.status);
  }

  async function refreshResources(): Promise<void> {
    const response = await fetch("/api/control/resources", { cache: "no-store" });
    const data = (await parseResponse(response)) as { resources: ResourceItem[] };
    setResources(data.resources || []);
  }

  async function refreshPresets(): Promise<void> {
    const response = await fetch("/api/control/presets", { cache: "no-store" });
    const data = (await parseResponse(response)) as { presets: Preset[] };
    const items = data.presets || [];
    setPresets(items);
    if (!presetName && items.length > 0) {
      setPresetName(items[0].name);
    }
  }

  async function refreshUsers(): Promise<void> {
    if (!isAdmin) {
      return;
    }
    const response = await fetch("/api/auth/users", { cache: "no-store" });
    const data = (await parseResponse(response)) as { users: UserItem[] };
    setUsers(data.users || []);
  }

  async function refreshAll(): Promise<void> {
    setLoading(true);
    setOutput("");
    try {
      await Promise.all([refreshStatus(), refreshResources(), refreshPresets(), refreshUsers()]);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Failed to refresh data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshAll();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusRows = useMemo(() => {
    if (!status) {
      return [];
    }
    return [
      ["VPN up", String(status.vpn_up)],
      ["nft table", String(status.nft_table_present)],
      ["nft nat", String(status.nft_nat_table_present)],
      ["timer", `${String(status.timer_enabled)} / ${String(status.timer_active)}`],
      ["watch", `${String(status.watch_enabled)} / ${String(status.watch_active)}`],
      ["blockpage", `${String(status.blockpage_enabled)} / ${String(status.blockpage_active)}`],
      [
        "blockpage-tls",
        `${String(status.tls_blockpage_enabled)} / ${String(status.tls_blockpage_active)}`,
      ],
    ];
  }, [status]);

  async function doApply(): Promise<void> {
    if (!isOperator) {
      return;
    }
    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/control/apply", { method: "POST" });
      const data = (await parseResponse(response)) as { stdout?: string };
      setOutput(data.stdout || "Rules applied.");
      await refreshStatus();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Apply failed");
    } finally {
      setLoading(false);
    }
  }

  async function doVerify(): Promise<void> {
    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/control/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 8 }),
      });
      const data = (await parseResponse(response)) as { ok: boolean; stdout?: string; stderr?: string };
      setOutput(`${data.ok ? "PASS" : "FAIL"}\n${data.stdout || data.stderr || ""}`.trim());
      await refreshStatus();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Verify failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyPreset(): Promise<void> {
    if (!isOperator) {
      return;
    }
    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/control/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: presetName }),
      });
      const data = (await parseResponse(response)) as { stdout?: string };
      setOutput(data.stdout || `Preset ${presetName} applied.`);
      await refreshAll();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Preset apply failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveResource(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!isOperator) {
      return;
    }

    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/control/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: resourceName,
          domains: splitLines(resourceDomains),
          requiredCountry: resourceCountry || undefined,
          requiredServer: resourceServer || undefined,
          allowedCountries: splitCsv(allowCountries),
          blockedCountries: splitCsv(blockCountries),
          blockedContextKeywords: splitCsv(blockContext),
          replace: replaceMode,
          runApply: true,
        }),
      });
      const data = (await parseResponse(response)) as { stdout?: string; apply?: { stdout?: string } };
      setOutput([data.stdout, data.apply?.stdout].filter(Boolean).join("\n") || "Resource saved.");
      await refreshAll();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Resource save failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteResource(name: string): Promise<void> {
    if (!isOperator) {
      return;
    }
    setLoading(true);
    setOutput("");
    try {
      const response = await fetch(`/api/control/resources?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const data = (await parseResponse(response)) as { stdout?: string; apply?: { stdout?: string } };
      setOutput([data.stdout, data.apply?.stdout].filter(Boolean).join("\n") || `Resource ${name} removed.`);
      await refreshAll();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Resource removal failed");
    } finally {
      setLoading(false);
    }
  }

  async function createUser(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          confirmPassword: newUserPassword2,
          role: newUserRole,
        }),
      });
      await parseResponse(response);
      setOutput(`User ${newUserEmail} created.`);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserPassword2("");
      setNewUserRole("VIEWER");
      await refreshUsers();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "User creation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-4 p-4 pb-10 md:grid-cols-12 md:p-6">
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">VRKS Control Plane</h1>
            <p className="text-sm text-slate-600">Full Next.js control plane with authenticated operations.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void doVerify()}
              disabled={loading}
              className="rounded-lg border border-cyan-700 bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
            >
              Verify
            </button>
            <button
              type="button"
              onClick={() => void doApply()}
              disabled={loading || !isOperator}
              className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-4">
        <h2 className="text-lg font-semibold">Runtime status</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {statusRows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="font-medium text-slate-600">{label}</dt>
              <dd className="text-right font-semibold text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <label className="text-sm font-medium text-slate-700" htmlFor="presetName">
              Preset
            </label>
            <select
              id="presetName"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            >
              {presets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void applyPreset()}
            disabled={!isOperator || loading || !presetName}
            className="rounded-lg border border-amber-600 bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Apply preset
          </button>
        </div>
        {presetName ? (
          <p className="mt-3 text-sm text-slate-600">
            {presets.find((item) => item.name === presetName)?.description || ""}
          </p>
        ) : null}
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-7">
        <h2 className="text-lg font-semibold">Resources</h2>
        <div className="mt-3 max-h-96 space-y-3 overflow-auto pr-1">
          {resources.length === 0 ? (
            <p className="text-sm text-slate-600">No resources configured.</p>
          ) : (
            resources.map((item) => (
              <article key={item.name} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{item.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{item.domains.join(", ")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteResource(item.name)}
                    disabled={!isOperator || loading}
                    className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-5">
        <h2 className="text-lg font-semibold">Add / update resource</h2>
        <form className="mt-3 space-y-3" onSubmit={saveResource}>
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourceName}
              onChange={(event) => setResourceName(event.target.value)}
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Domains (one per line)
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourceDomains}
              onChange={(event) => setResourceDomains(event.target.value)}
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Required country
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourceCountry}
              onChange={(event) => setResourceCountry(event.target.value)}
              placeholder="US"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Required server pattern
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourceServer}
              onChange={(event) => setResourceServer(event.target.value)}
              placeholder="m247"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Allowed countries (CSV)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={allowCountries}
              onChange={(event) => setAllowCountries(event.target.value)}
              placeholder="US,DE,FR"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Blocked countries (CSV)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={blockCountries}
              onChange={(event) => setBlockCountries(event.target.value)}
              placeholder="RU,IR,KP"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Blocked context keywords (CSV)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={blockContext}
              onChange={(event) => setBlockContext(event.target.value)}
              placeholder="crimea,donetsk,luhansk"
            />
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={replaceMode} onChange={(event) => setReplaceMode(event.target.checked)} />
            Replace existing resource if found
          </label>

          <button
            type="submit"
            disabled={loading || !isOperator}
            className="w-full rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save resource
          </button>
        </form>
      </section>

      {isAdmin ? (
        <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">User management (ADMIN)</h2>
          <form className="mt-3 grid gap-3 md:grid-cols-5" onSubmit={createUser}>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Name"
              value={newUserName}
              onChange={(event) => setNewUserName(event.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Email"
              type="email"
              value={newUserEmail}
              onChange={(event) => setNewUserEmail(event.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Password"
              type="password"
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              required
              minLength={10}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Confirm"
              type="password"
              value={newUserPassword2}
              onChange={(event) => setNewUserPassword2(event.target.value)}
              required
              minLength={10}
            />
            <div className="flex gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={newUserRole}
                onChange={(event) => setNewUserRole(event.target.value)}
              >
                <option value="VIEWER">VIEWER</option>
                <option value="OPERATOR">OPERATOR</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg border border-indigo-700 bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Last login</th>
                  <th className="px-2 py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-2 py-2 font-medium text-slate-800">{user.name}</td>
                    <td className="px-2 py-2 text-slate-700">{user.email}</td>
                    <td className="px-2 py-2">{user.role}</td>
                    <td className="px-2 py-2 text-slate-600">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"}</td>
                    <td className="px-2 py-2 text-slate-600">{new Date(user.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output || "(idle)"}</pre>
      </section>
    </main>
  );
}
