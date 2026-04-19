"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiExportAuditLogs, apiGetAuditLogs } from "@/lib/api/client";
import { downloadJson, formatDate } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type AuditItem = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  payload: string | null;
  payloadParsed: unknown;
  createdAt: string;
};

type AuditMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DEFAULT_META: AuditMeta = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
};

function payloadPreview(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "-";
  }
  try {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return String(payload);
  }
}

export function AuditPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [meta, setMeta] = useState<AuditMeta>(DEFAULT_META);
  const [output, setOutput] = useState("(idle)");

  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const isAdmin = userRole === "ADMIN";

  async function refresh(): Promise<void> {
    if (!isAdmin) {
      return;
    }
    setLoading(true);
    try {
      const data = await apiGetAuditLogs({
        q: q.trim() || undefined,
        actor: actor.trim() || undefined,
        action: action.trim() || undefined,
        target: target.trim() || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page,
        pageSize,
      });

      if ("meta" in data) {
        setItems(data.items || []);
        setMeta(data.meta || DEFAULT_META);
        setOutput(`Loaded ${data.items?.length || 0} audit records.`);
      } else {
        setItems(data.items || []);
        setMeta(DEFAULT_META);
        setOutput(`Loaded ${data.items?.length || 0} audit records.`);
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  async function exportJson(): Promise<void> {
    if (!isAdmin) {
      return;
    }
    setLoading(true);
    try {
      const data = await apiExportAuditLogs({
        q: q.trim() || undefined,
        actor: actor.trim() || undefined,
        action: action.trim() || undefined,
        target: target.trim() || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page,
        pageSize,
      });
      if ("count" in data) {
        downloadJson(`vrks-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, data);
        setOutput(`Exported ${data.count} audit records.`);
      } else {
        downloadJson(`vrks-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, data);
        setOutput(`Exported ${data.items.length} audit records.`);
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Audit export failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  if (!isAdmin) {
    return (
      <main className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 border-amber-300 bg-amber-50/80">
          <CardHeader>
            <CardTitle className="text-2xl text-amber-900">Audit</CardTitle>
            <CardDescription className="text-amber-800">
              Only ADMIN role can access audit center.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Audit center</CardTitle>
            <CardDescription>Filter, inspect, and export control-plane audit events.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportJson()} disabled={loading}>
              Export JSON
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="audit-q">Search</Label>
            <Input id="audit-q" value={q} onChange={(event) => setQ(event.target.value)} placeholder="q..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-actor">Actor</Label>
            <Input id="audit-actor" value={actor} onChange={(event) => setActor(event.target.value)} placeholder="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-action">Action</Label>
            <Input id="audit-action" value={action} onChange={(event) => setAction(event.target.value)} placeholder="action..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-target">Target</Label>
            <Input id="audit-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="target..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-page-size">Page size</Label>
            <Input
              id="audit-page-size"
              type="number"
              min={10}
              max={200}
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value) || 50);
              }}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={() => {
              setPage(1);
              void refresh();
            }} disabled={loading}>
              Apply filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Audit logs</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Total: {meta.total}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading || meta.page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Prev
            </Button>
            <span>
              Page {meta.page} / {meta.totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading || meta.page >= meta.totalPages}
              onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>At</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDate(item.createdAt)}</TableCell>
                  <TableCell className="max-w-56 truncate">{item.actorEmail || "-"}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell className="max-w-52 truncate">{item.target || "-"}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">{payloadPreview(item.payloadParsed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
