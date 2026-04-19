"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
      <Card className="col-span-12">
        <CardHeader>
          <CardTitle className="text-2xl">Profiles</CardTitle>
          <CardDescription>
            Resource profile inventory with search, policy filters, and lifecycle actions.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="col-span-12">
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <form
              className="flex min-w-64 flex-1 items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setResourcePage(1);
                setResourceSearch(resourceSearchInput.trim());
              }}
            >
              <div className="min-w-56 flex-1 space-y-2">
                <Label htmlFor="resource-search">Search resource/domain</Label>
                <Input
                  id="resource-search"
                  value={resourceSearchInput}
                  onChange={(event) => setResourceSearchInput(event.target.value)}
                  placeholder="antigravity, yandex, googleapis..."
                />
              </div>
              <Button type="submit" variant="outline" disabled={controlsDisabled}>
                Filter
              </Button>
            </form>

            <div className="space-y-2">
              <Label>Sort</Label>
              <Select
                value={resourceSort}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setResourcePage(1);
                  setResourceSort(value as ResourceSort);
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name_asc">Name A-Z</SelectItem>
                  <SelectItem value="name_desc">Name Z-A</SelectItem>
                  <SelectItem value="domains_desc">Domains desc</SelectItem>
                  <SelectItem value="domains_asc">Domains asc</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Policy</Label>
              <Select
                value={resourcePolicy}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setResourcePage(1);
                  setResourcePolicy(value as PolicyFilter);
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="restricted">Restricted only</SelectItem>
                  <SelectItem value="open">Open only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Page size</Label>
              <Select
                value={String(resourcePageSize)}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setResourcePage(1);
                  setResourcePageSize(Number(value));
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p>
              Showing {resources.length} / {resourceMeta.total} filtered (total configured: {resourceMeta.totalAll})
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={controlsDisabled || resourceMeta.page <= 1}
                onClick={() => setResourcePage((value) => Math.max(1, value - 1))}
              >
                Prev
              </Button>
              <span>
                Page {resourceMeta.page} / {resourceMeta.totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={controlsDisabled || resourceMeta.page >= resourceMeta.totalPages}
                onClick={() => setResourcePage((value) => Math.min(resourceMeta.totalPages, value + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-7">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Resource profiles</CardTitle>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1 text-xs">
              <Checkbox
                checked={deleteRunApply}
                onCheckedChange={(value) => setDeleteRunApply(Boolean(value))}
                id="delete-run-apply"
              />
              <span>apply on remove</span>
            </label>
            <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1 text-xs">
              <Checkbox
                checked={deleteRunVerify}
                onCheckedChange={(value) => setDeleteRunVerify(Boolean(value))}
                id="delete-run-verify"
              />
              <span>verify on remove</span>
            </label>
            <Input
              className="h-7 w-20 text-xs"
              type="number"
              min={3}
              max={60}
              value={deleteVerifyTimeout}
              onChange={(event) => setDeleteVerifyTimeout(Number(event.target.value) || 8)}
              title="remove verify timeout"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[34rem] space-y-3 overflow-auto pr-1">
            {resources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No resources configured for current filter.</p>
            ) : (
              resources.map((item) => (
                <article key={item.name} className="rounded-lg border bg-muted/20 p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{item.name}</h3>
                        <Badge variant="outline">{item.domainCount ?? item.domains.length} domains</Badge>
                        <Badge variant={item.hasPolicyConstraints ? "secondary" : "outline"}>
                          {item.hasPolicyConstraints ? "restricted" : "open"}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {policySummary(item.policy)}
                      </p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{item.domains.join(", ")}</p>
                    </div>
                    <div className="flex w-full flex-col gap-1 sm:w-28">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => loadResourceIntoForm(item, false)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => loadResourceIntoForm(item, true)}
                      >
                        Duplicate
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        onClick={() => void deleteResource(item.name)}
                        disabled={!isOperator || controlsDisabled}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-5">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{editingResource ? `Edit ${editingResource}` : "Add / update resource"}</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={resetResourceForm}>
            Reset form
          </Button>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={saveResource}>
            <div className="space-y-2">
              <Label htmlFor="resource-name">Name</Label>
              <Input
                id="resource-name"
                value={resourceName}
                onChange={(event) => setResourceName(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-domains">Domains (one per line)</Label>
              <Textarea
                id="resource-domains"
                className="min-h-24"
                value={resourceDomains}
                onChange={(event) => setResourceDomains(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-country">Required country</Label>
              <Input
                id="resource-country"
                value={resourceCountry}
                onChange={(event) => setResourceCountry(event.target.value)}
                placeholder="US"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-server">Required server pattern</Label>
              <Input
                id="resource-server"
                value={resourceServer}
                onChange={(event) => setResourceServer(event.target.value)}
                placeholder="m247"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="allow-countries">Allowed countries (CSV)</Label>
              <Input
                id="allow-countries"
                value={allowCountries}
                onChange={(event) => setAllowCountries(event.target.value)}
                placeholder="US,DE,FR"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="block-countries">Blocked countries (CSV)</Label>
              <Input
                id="block-countries"
                value={blockCountries}
                onChange={(event) => setBlockCountries(event.target.value)}
                placeholder="RU,IR,KP"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="block-context">Blocked context keywords (CSV)</Label>
              <Input
                id="block-context"
                value={blockContext}
                onChange={(event) => setBlockContext(event.target.value)}
                placeholder="crimea,donetsk,luhansk"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-2">
                <Checkbox
                  checked={replaceMode}
                  onCheckedChange={(value) => setReplaceMode(Boolean(value))}
                  id="replace-mode"
                />
                <span>replace existing</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-2">
                <Checkbox
                  checked={saveRunApply}
                  onCheckedChange={(value) => setSaveRunApply(Boolean(value))}
                  id="save-run-apply"
                />
                <span>run apply</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-2">
                <Checkbox
                  checked={saveRunVerify}
                  onCheckedChange={(value) => setSaveRunVerify(Boolean(value))}
                  id="save-run-verify"
                />
                <span>run verify</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-2">
                <span>timeout</span>
                <Input
                  className="h-7 w-20"
                  type="number"
                  min={3}
                  max={60}
                  value={saveVerifyTimeout}
                  onChange={(event) => setSaveVerifyTimeout(Number(event.target.value) || 8)}
                />
              </label>
            </div>

            <Button type="submit" className="w-full" disabled={controlsDisabled || !isOperator}>
              Save resource
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
