"use client";

import { useState } from "react";

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
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Imports / Exports</h1>
            <p className="text-sm text-slate-600">Bulk profile transport with validation and operational safeguards.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runExport()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => void runValidate()}
              disabled={loading}
              className="rounded-lg border border-sky-600 bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              Validate JSON
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={loading || !isOperator}
              className="rounded-lg border border-violet-700 bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            >
              Import JSON
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-8">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            Import mode
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={importMode}
              onChange={(event) => setImportMode(event.target.value as ImportMode)}
            >
              <option value="merge">merge (upsert only)</option>
              <option value="replace_all">replace_all (remove missing)</option>
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 md:mt-6">
            <input type="checkbox" checked={importRunApply} onChange={(event) => setImportRunApply(event.target.checked)} />
            run apply
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 md:mt-6">
            <input type="checkbox" checked={importRunVerify} onChange={(event) => setImportRunVerify(event.target.checked)} />
            run verify
          </label>

          <label className="text-sm font-medium text-slate-700">
            Verify timeout
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="number"
              min={3}
              max={60}
              value={importVerifyTimeout}
              onChange={(event) => setImportVerifyTimeout(Number(event.target.value) || 8)}
            />
          </label>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Import payload (JSON)
          <textarea
            className="mt-1 min-h-72 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            value={importJson}
            onChange={(event) => setImportJson(event.target.value)}
            placeholder="Paste exported JSON or array of resources"
          />
        </label>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-4">
        <h2 className="text-lg font-semibold">Validation preview</h2>
        <textarea
          className="mt-3 min-h-56 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
          value={validationOutput}
          readOnly
        />

        <h2 className="mt-4 text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
