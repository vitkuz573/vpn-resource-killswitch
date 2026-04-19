"use client";

import { useEffect, useMemo, useState } from "react";

import { parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

export function OverviewPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [output, setOutput] = useState("(idle)");

  const isOperator = userRole === "ADMIN" || userRole === "OPERATOR";

  async function refreshStatus(): Promise<void> {
    const response = await fetch("/api/control/status", { cache: "no-store" });
    const data = await parseResponse<{ status: Record<string, unknown> }>(response);
    setStatus(data.status);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshStatus().catch((error: unknown) => {
        setOutput(error instanceof Error ? error.message : "Failed to fetch runtime status");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const statusRows = useMemo(() => {
    if (!status) {
      return [] as Array<[string, string]>;
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

  async function runApply(): Promise<void> {
    if (!isOperator) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/control/apply", { method: "POST" });
      const data = await parseResponse<{ stdout?: string }>(response);
      setOutput(data.stdout || "Rules applied.");
      await refreshStatus();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Apply failed");
    } finally {
      setLoading(false);
    }
  }

  async function runVerify(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/api/control/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout: 8 }),
      });
      const data = await parseResponse<{ ok: boolean; stdout?: string; stderr?: string }>(response);
      setOutput(`${data.ok ? "PASS" : "FAIL"}\n${data.stdout || data.stderr || ""}`.trim());
      await refreshStatus();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Verify failed");
    } finally {
      setLoading(false);
    }
  }

  async function runRefresh(): Promise<void> {
    setLoading(true);
    try {
      await refreshStatus();
      setOutput("Runtime status refreshed.");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Overview</h1>
            <p className="text-sm text-slate-600">Runtime health, apply, and verification controls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runRefresh()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void runVerify()}
              disabled={loading}
              className="rounded-lg border border-cyan-700 bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
            >
              Verify
            </button>
            <button
              type="button"
              onClick={() => void runApply()}
              disabled={loading || !isOperator}
              className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-6">
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

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-6">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
