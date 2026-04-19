"use client";

import { useEffect, useState } from "react";

import { parseResponse, policySummary, splitCsv, splitLines } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type ResourceSort = "name_asc" | "name_desc" | "domains_asc" | "domains_desc";
type PolicyFilter = "all" | "restricted" | "open";

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
  domainCount?: number;
  policy?: ResourcePolicy;
  hasPolicyConstraints?: boolean;
};

type ResourceListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalAll: number;
};

const DEFAULT_RESOURCE_META: ResourceListMeta = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
  totalAll: 0,
};

export function ProfilesPageClient({ userRole }: Props) {
  const [busy, setBusy] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [resourceMeta, setResourceMeta] = useState<ResourceListMeta>(DEFAULT_RESOURCE_META);
  const [output, setOutput] = useState("(idle)");

  const [resourceSearchInput, setResourceSearchInput] = useState("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceSort, setResourceSort] = useState<ResourceSort>("name_asc");
  const [resourcePolicy, setResourcePolicy] = useState<PolicyFilter>("all");
  const [resourcePage, setResourcePage] = useState(1);
  const [resourcePageSize, setResourcePageSize] = useState(25);

  const [editingResource, setEditingResource] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState("");
  const [resourceDomains, setResourceDomains] = useState("");
  const [resourceCountry, setResourceCountry] = useState("");
  const [resourceServer, setResourceServer] = useState("");
  const [allowCountries, setAllowCountries] = useState("");
  const [blockCountries, setBlockCountries] = useState("");
  const [blockContext, setBlockContext] = useState("");
  const [replaceMode, setReplaceMode] = useState(true);
  const [saveRunApply, setSaveRunApply] = useState(true);
  const [saveRunVerify, setSaveRunVerify] = useState(false);
  const [saveVerifyTimeout, setSaveVerifyTimeout] = useState(8);

  const [deleteRunApply, setDeleteRunApply] = useState(true);
  const [deleteRunVerify, setDeleteRunVerify] = useState(false);
  const [deleteVerifyTimeout, setDeleteVerifyTimeout] = useState(8);

  const isOperator = userRole === "ADMIN" || userRole === "OPERATOR";

  async function refreshResources(): Promise<void> {
    setResourcesLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(resourcePage),
        pageSize: String(resourcePageSize),
        sort: resourceSort,
        policy: resourcePolicy,
      });
      if (resourceSearch.trim()) {
        params.set("q", resourceSearch.trim());
      }

      const response = await fetch(`/api/control/resources?${params.toString()}`, { cache: "no-store" });
      const data = await parseResponse<{
        resources?: ResourceItem[];
        items?: ResourceItem[];
        meta?: ResourceListMeta;
      }>(response);

      const items = data.resources || data.items || [];
      setResources(items);

      if (data.meta) {
        setResourceMeta(data.meta);
        if (data.meta.page !== resourcePage) {
          setResourcePage(data.meta.page);
        }
      } else {
        setResourceMeta(DEFAULT_RESOURCE_META);
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Failed to refresh resources");
    } finally {
      setResourcesLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshResources();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceSearch, resourceSort, resourcePolicy, resourcePage, resourcePageSize]);

  function resetResourceForm(): void {
    setEditingResource(null);
    setResourceName("");
    setResourceDomains("");
    setResourceCountry("");
    setResourceServer("");
    setAllowCountries("");
    setBlockCountries("");
    setBlockContext("");
    setReplaceMode(true);
    setSaveRunApply(true);
    setSaveRunVerify(false);
    setSaveVerifyTimeout(8);
  }

  function loadResourceIntoForm(item: ResourceItem, duplicate: boolean): void {
    setEditingResource(duplicate ? null : item.name);
    setResourceName(duplicate ? `${item.name}-copy` : item.name);
    setResourceDomains((item.domains || []).join("\n"));
    setResourceCountry(item.policy?.required_country || "");
    setResourceServer(item.policy?.required_server || "");
    setAllowCountries((item.policy?.allowed_countries || []).join(","));
    setBlockCountries((item.policy?.blocked_countries || []).join(","));
    setBlockContext((item.policy?.blocked_context_keywords || []).join(","));
    setReplaceMode(true);
  }

  async function saveResource(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!isOperator) {
      return;
    }

    setBusy(true);
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
          runApply: saveRunApply,
          runVerify: saveRunVerify,
          verifyTimeout: saveVerifyTimeout,
        }),
      });
      const data = await parseResponse<{
        ok: boolean;
        stdout?: string;
        apply?: { stdout?: string } | null;
        verify?: { ok: boolean; stdout?: string; stderr?: string } | null;
      }>(response);

      const lines: string[] = [];
      lines.push(data.stdout || "Resource saved.");
      if (data.apply?.stdout) {
        lines.push(data.apply.stdout);
      }
      if (data.verify) {
        lines.push(`verify: ${data.verify.ok ? "PASS" : "FAIL"}`);
        lines.push((data.verify.stdout || data.verify.stderr || "").trim());
      }
      setOutput(lines.filter(Boolean).join("\n"));

      await refreshResources();
      resetResourceForm();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Resource save failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteResource(name: string): Promise<void> {
    if (!isOperator) {
      return;
    }
    if (!window.confirm(`Remove resource '${name}'?`)) {
      return;
    }

    setBusy(true);
    try {
      const params = new URLSearchParams({
        name,
        runApply: String(deleteRunApply),
        runVerify: String(deleteRunVerify),
        verifyTimeout: String(deleteVerifyTimeout),
      });
      const response = await fetch(`/api/control/resources?${params.toString()}`, { method: "DELETE" });

      const data = await parseResponse<{
        ok: boolean;
        stdout?: string;
        apply?: { stdout?: string } | null;
        verify?: { ok: boolean; stdout?: string; stderr?: string } | null;
      }>(response);

      const lines: string[] = [];
      lines.push(data.stdout || `Resource ${name} removed.`);
      if (data.apply?.stdout) {
        lines.push(data.apply.stdout);
      }
      if (data.verify) {
        lines.push(`verify: ${data.verify.ok ? "PASS" : "FAIL"}`);
        lines.push((data.verify.stdout || data.verify.stderr || "").trim());
      }
      setOutput(lines.filter(Boolean).join("\n"));

      await refreshResources();
      if (editingResource === name) {
        resetResourceForm();
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Resource removal failed");
    } finally {
      setBusy(false);
    }
  }

  const controlsDisabled = busy || resourcesLoading;

  return (
    <main className="grid grid-cols-12 gap-4">
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Profiles</h1>
        <p className="text-sm text-slate-600">Resource profile inventory with search, policy filters, and lifecycle actions.</p>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex min-w-64 flex-1 items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setResourcePage(1);
              setResourceSearch(resourceSearchInput.trim());
            }}
          >
            <div className="min-w-56 flex-1">
              <label className="text-sm font-medium text-slate-700">Search resource/domain</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={resourceSearchInput}
                onChange={(event) => setResourceSearchInput(event.target.value)}
                placeholder="antigravity, yandex, googleapis..."
              />
            </div>
            <button
              type="submit"
              disabled={controlsDisabled}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Filter
            </button>
          </form>

          <div>
            <label className="text-sm font-medium text-slate-700">Sort</label>
            <select
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourceSort}
              onChange={(event) => {
                setResourcePage(1);
                setResourceSort(event.target.value as ResourceSort);
              }}
            >
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
              <option value="domains_desc">Domains desc</option>
              <option value="domains_asc">Domains asc</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Policy</label>
            <select
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourcePolicy}
              onChange={(event) => {
                setResourcePage(1);
                setResourcePolicy(event.target.value as PolicyFilter);
              }}
            >
              <option value="all">All</option>
              <option value="restricted">Restricted only</option>
              <option value="open">Open only</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Page size</label>
            <select
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={resourcePageSize}
              onChange={(event) => {
                setResourcePage(1);
                setResourcePageSize(Number(event.target.value));
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <p>
            Showing {resources.length} / {resourceMeta.total} filtered (total configured: {resourceMeta.totalAll})
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={controlsDisabled || resourceMeta.page <= 1}
              onClick={() => setResourcePage((value) => Math.max(1, value - 1))}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <span>
              Page {resourceMeta.page} / {resourceMeta.totalPages}
            </span>
            <button
              type="button"
              disabled={controlsDisabled || resourceMeta.page >= resourceMeta.totalPages}
              onClick={() => setResourcePage((value) => Math.min(resourceMeta.totalPages, value + 1))}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Resource profiles</h2>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <label className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
              <input type="checkbox" checked={deleteRunApply} onChange={(event) => setDeleteRunApply(event.target.checked)} />
              apply on remove
            </label>
            <label className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
              <input type="checkbox" checked={deleteRunVerify} onChange={(event) => setDeleteRunVerify(event.target.checked)} />
              verify on remove
            </label>
            <input
              className="w-16 rounded-md border border-slate-300 px-2 py-1"
              type="number"
              min={3}
              max={60}
              value={deleteVerifyTimeout}
              onChange={(event) => setDeleteVerifyTimeout(Number(event.target.value) || 8)}
              title="remove verify timeout"
            />
          </div>
        </div>

        <div className="mt-3 max-h-[34rem] space-y-3 overflow-auto pr-1">
          {resources.length === 0 ? (
            <p className="text-sm text-slate-600">No resources configured for current filter.</p>
          ) : (
            resources.map((item) => (
              <article key={item.name} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{item.name}</h3>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                        {item.domainCount ?? item.domains.length} domains
                      </span>
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                        {item.hasPolicyConstraints ? "restricted" : "open"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 break-words [overflow-wrap:anywhere]">
                      {policySummary(item.policy)}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500">{item.domains.join(", ")}</p>
                  </div>
                  <div className="flex w-full flex-col gap-1 sm:w-28">
                    <button
                      type="button"
                      onClick={() => loadResourceIntoForm(item, false)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-center text-xs hover:bg-slate-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => loadResourceIntoForm(item, true)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-center text-xs hover:bg-slate-100"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteResource(item.name)}
                      disabled={!isOperator || controlsDisabled}
                      className="w-full rounded-md border border-rose-300 px-2 py-1 text-center text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{editingResource ? `Edit ${editingResource}` : "Add / update resource"}</h2>
          <button
            type="button"
            onClick={resetResourceForm}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
          >
            Reset form
          </button>
        </div>

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

          <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <input type="checkbox" checked={replaceMode} onChange={(event) => setReplaceMode(event.target.checked)} />
              replace existing
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <input type="checkbox" checked={saveRunApply} onChange={(event) => setSaveRunApply(event.target.checked)} />
              run apply
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              <input type="checkbox" checked={saveRunVerify} onChange={(event) => setSaveRunVerify(event.target.checked)} />
              run verify
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
              timeout
              <input
                className="w-16 rounded-md border border-slate-300 px-2 py-1"
                type="number"
                min={3}
                max={60}
                value={saveVerifyTimeout}
                onChange={(event) => setSaveVerifyTimeout(Number(event.target.value) || 8)}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={controlsDisabled || !isOperator}
            className="w-full rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save resource
          </button>
        </form>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
