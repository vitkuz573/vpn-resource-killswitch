"use client";

import { useState } from "react";

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
import { downloadJson, parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type ImportMode = "merge" | "replace_all";

type ValidateResponse = {
  ok: boolean;
  warnings: string[];
  count: number;
  resources: Array<{
    name: string;
    domains: string[];
    domainCount: number;
    policySummary: string;
  }>;
};

function parseImportPayload(rawText: string): { resources: Array<Record<string, unknown>> } {
  const parsed = JSON.parse(rawText) as unknown;
  if (Array.isArray(parsed)) {
    return { resources: parsed as Array<Record<string, unknown>> };
  }
  if (parsed && typeof parsed === "object") {
    const value = parsed as { resources?: unknown };
    if (Array.isArray(value.resources)) {
      return { resources: value.resources as Array<Record<string, unknown>> };
    }
  }
  throw new Error("Import JSON must be an array of resources or object with `resources` field.");
}

export function ImportsPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importRunApply, setImportRunApply] = useState(true);
  const [importRunVerify, setImportRunVerify] = useState(false);
  const [importVerifyTimeout, setImportVerifyTimeout] = useState(8);
  const [validationOutput, setValidationOutput] = useState("(not validated)");
  const [output, setOutput] = useState("(idle)");

  const isOperator = userRole === "ADMIN" || userRole === "OPERATOR";

  async function runExport(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/api/control/resources/export", { cache: "no-store" });
      const data = await parseResponse<{
        formatVersion: number;
        exportedAt: string;
        fingerprint: string;
        resources: Array<Record<string, unknown>>;
      }>(response);

      const text = JSON.stringify(data, null, 2);
      setImportJson(text);
      setValidationOutput("(not validated)");

      downloadJson(`vrks-resources-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, data);
      setOutput(`Exported ${data.resources.length} resources. fingerprint=${data.fingerprint.slice(0, 16)}...`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  async function runValidate(): Promise<void> {
    setLoading(true);
    try {
      const payload = parseImportPayload(importJson);
      const response = await fetch("/api/control/resources/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resources: payload.resources }),
      });
      const data = await parseResponse<ValidateResponse>(response);

      const lines: string[] = [];
      lines.push(`validated resources: ${data.count}`);
      if (data.warnings.length > 0) {
        lines.push(`warnings: ${data.warnings.join(" | ")}`);
      }
      for (const item of data.resources.slice(0, 20)) {
        lines.push(`- ${item.name} (${item.domainCount} domains) :: ${item.policySummary}`);
      }
      if (data.resources.length > 20) {
        lines.push(`... and ${data.resources.length - 20} more`);
      }

      const text = lines.join("\n");
      setValidationOutput(text);
      setOutput(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Validation failed";
      setValidationOutput(text);
      setOutput(text);
    } finally {
      setLoading(false);
    }
  }

  async function runImport(): Promise<void> {
    if (!isOperator) {
      return;
    }

    setLoading(true);
    try {
      const payload = parseImportPayload(importJson);
      const response = await fetch("/api/control/resources/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resources: payload.resources,
          mode: importMode,
          runApply: importRunApply,
          runVerify: importRunVerify,
          verifyTimeout: importVerifyTimeout,
        }),
      });

      const data = await parseResponse<{
        ok: boolean;
        mode: ImportMode;
        counts: {
          input: number;
          upserted: number;
          removed: number;
          createdApprox: number;
          updatedApprox: number;
        };
        verify?: { ok: boolean; stdout?: string; stderr?: string } | null;
      }>(response);

      const lines: string[] = [];
      lines.push(`import mode: ${data.mode}`);
      lines.push(
        `input=${data.counts.input} upserted=${data.counts.upserted} removed=${data.counts.removed} created~=${data.counts.createdApprox} updated~=${data.counts.updatedApprox}`,
      );
      if (data.verify) {
        lines.push(`verify: ${data.verify.ok ? "PASS" : "FAIL"}`);
      }
      setOutput(lines.join("\n"));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Imports / Exports</CardTitle>
            <CardDescription>
              Bulk profile transport with validation and operational safeguards.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void runExport()} disabled={loading}>
              Export JSON
            </Button>
            <Button type="button" variant="secondary" onClick={() => void runValidate()} disabled={loading}>
              Validate JSON
            </Button>
            <Button type="button" onClick={() => void runImport()} disabled={loading || !isOperator}>
              Import JSON
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className="col-span-12 md:col-span-8">
        <CardHeader>
          <CardTitle>Import settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Import mode</Label>
              <Select
                value={importMode}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  setImportMode(value as ImportMode);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">merge (upsert only)</SelectItem>
                  <SelectItem value="replace_all">replace_all (remove missing)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 md:mt-7">
              <Checkbox
                checked={importRunApply}
                onCheckedChange={(value) => setImportRunApply(Boolean(value))}
                id="import-run-apply"
              />
              <Label htmlFor="import-run-apply">run apply</Label>
            </div>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 md:mt-7">
              <Checkbox
                checked={importRunVerify}
                onCheckedChange={(value) => setImportRunVerify(Boolean(value))}
                id="import-run-verify"
              />
              <Label htmlFor="import-run-verify">run verify</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-verify-timeout">Verify timeout</Label>
              <Input
                id="import-verify-timeout"
                type="number"
                min={3}
                max={60}
                value={importVerifyTimeout}
                onChange={(event) => setImportVerifyTimeout(Number(event.target.value) || 8)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-json">Import payload (JSON)</Label>
            <Textarea
              id="import-json"
              className="min-h-72 font-mono text-xs"
              value={importJson}
              onChange={(event) => setImportJson(event.target.value)}
              placeholder="Paste exported JSON or array of resources"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-4">
        <CardHeader>
          <CardTitle>Validation preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea className="min-h-56 font-mono text-xs" value={validationOutput} readOnly />
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Output</h3>
            <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
