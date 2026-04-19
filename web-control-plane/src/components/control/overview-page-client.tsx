"use client";

import { useEffect, useState } from "react";

import { parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type RuntimeUnit = "timer" | "watch" | "blockpage" | "blockpage-tls" | "all";
type RuntimeManageAction =
  | "start"
  | "stop"
  | "restart"
  | "enable"
  | "disable"
  | "enable-now"
  | "disable-now";

export function OverviewPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [output, setOutput] = useState("(idle)");
  const [teardownPurge, setTeardownPurge] = useState(false);
  const [teardownRemoveBin, setTeardownRemoveBin] = useState(false);

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

  function statusValue(key: string): string {
    if (!status) {
      return "unknown";
    }
    const value = status[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "unknown";
  }

  const statusRows: Array<[string, string]> = status
    ? [
        ["VPN up", statusValue("vpn_up")],
        ["nft table", statusValue("nft_table_present")],
        ["nft nat", statusValue("nft_nat_table_present")],
        ["timer", `${statusValue("timer_enabled")} / ${statusValue("timer_active")}`],
        ["watch", `${statusValue("watch_enabled")} / ${statusValue("watch_active")}`],
        ["blockpage", `${statusValue("blockpage_enabled")} / ${statusValue("blockpage_active")}`],
        [
          "blockpage-tls",
          `${statusValue("tls_blockpage_enabled")} / ${statusValue("tls_blockpage_active")}`,
        ],
      ]
    : [];

  const unitCards = [
    {
      key: "timer" as RuntimeUnit,
      label: "Timer",
      description: "Periodic refresh unit.",
      enabled: statusValue("timer_enabled"),
      active: statusValue("timer_active"),
    },
    {
      key: "watch" as RuntimeUnit,
      label: "Watch",
      description: "Realtime link/route monitor.",
      enabled: statusValue("watch_enabled"),
      active: statusValue("watch_active"),
    },
    {
      key: "blockpage" as RuntimeUnit,
      label: "Blockpage HTTP",
      description: "HTTP block page service.",
      enabled: statusValue("blockpage_enabled"),
      active: statusValue("blockpage_active"),
    },
    {
      key: "blockpage-tls" as RuntimeUnit,
      label: "Blockpage TLS",
      description: "HTTPS block page service.",
      enabled: statusValue("tls_blockpage_enabled"),
      active: statusValue("tls_blockpage_active"),
    },
  ];

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

  type RuntimeOperation =
    | {
        operation: "manage_unit";
        unit: RuntimeUnit;
        action: RuntimeManageAction;
      }
    | {
        operation: "disable_rules";
      }
    | {
        operation: "teardown";
        purge: boolean;
        removeBin: boolean;
      };

  async function runRuntimeOperation(payload: RuntimeOperation, label: string): Promise<void> {
    if (!isOperator) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/control/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseResponse<{ ok: boolean; stdout?: string }>(response);
      setOutput(`${label}\n${(data.stdout || "").trim()}`.trim());
      await refreshStatus();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Runtime operation failed");
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
        <h2 className="text-lg font-semibold">Runtime management</h2>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Global</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void runRuntimeOperation(
                  { operation: "manage_unit", unit: "all", action: "enable-now" },
                  "Runtime stack enabled",
                )
              }
              disabled={loading || !isOperator}
              className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() =>
                void runRuntimeOperation(
                  { operation: "manage_unit", unit: "all", action: "restart" },
                  "Runtime stack restarted",
                )
              }
              disabled={loading || !isOperator}
              className="rounded-lg border border-cyan-700 bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
            >
              Restart all
            </button>
            <button
              type="button"
              onClick={() =>
                void runRuntimeOperation(
                  { operation: "manage_unit", unit: "all", action: "disable-now" },
                  "Runtime stack disabled",
                )
              }
              disabled={loading || !isOperator}
              className="rounded-lg border border-amber-700 bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Disable all
            </button>
            <button
              type="button"
              onClick={() =>
                void runRuntimeOperation(
                  { operation: "disable_rules" },
                  "Rules disabled (nft table removed)",
                )
              }
              disabled={loading || !isOperator}
              className="rounded-lg border border-rose-700 bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
            >
              Disable rules
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {unitCards.map((unit) => (
            <article key={unit.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{unit.label}</h3>
                  <p className="text-xs text-slate-600">{unit.description}</p>
                </div>
                <div className="text-right text-xs text-slate-700">
                  <p>
                    <span className="font-semibold">enabled:</span> {unit.enabled}
                  </p>
                  <p>
                    <span className="font-semibold">active:</span> {unit.active}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: unit.key, action: "start" },
                      `${unit.label}: started`,
                    )
                  }
                  disabled={loading || !isOperator}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: unit.key, action: "stop" },
                      `${unit.label}: stopped`,
                    )
                  }
                  disabled={loading || !isOperator}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: unit.key, action: "restart" },
                      `${unit.label}: restarted`,
                    )
                  }
                  disabled={loading || !isOperator}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
                >
                  Restart
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runRuntimeOperation(
                      {
                        operation: "manage_unit",
                        unit: unit.key,
                        action: "enable-now",
                      },
                      `${unit.label}: enabled`,
                    )
                  }
                  disabled={loading || !isOperator}
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  Enable
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runRuntimeOperation(
                      {
                        operation: "manage_unit",
                        unit: unit.key,
                        action: "disable-now",
                      },
                      `${unit.label}: disabled`,
                    )
                  }
                  disabled={loading || !isOperator}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Disable
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Danger zone</p>
          <p className="mt-1 text-xs text-rose-700">Teardown removes VRKS runtime units and stops protection.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-rose-800">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={teardownPurge}
                onChange={(event) => setTeardownPurge(event.target.checked)}
              />
              purge config/state
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={teardownRemoveBin}
                onChange={(event) => setTeardownRemoveBin(event.target.checked)}
              />
              remove runtime binary
            </label>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Run VRKS teardown? This will stop runtime protection.")) {
                  return;
                }
                void runRuntimeOperation(
                  {
                    operation: "teardown",
                    purge: teardownPurge,
                    removeBin: teardownRemoveBin,
                  },
                  "Runtime teardown completed",
                );
              }}
              disabled={loading || !isOperator}
              className="rounded-md border border-rose-700 bg-rose-700 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
            >
              Run teardown
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
