"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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

  const unitActions = [
    {
      key: "timer" as RuntimeUnit,
      label: "Timer",
      description: "Periodic refresh unit.",
    },
    {
      key: "watch" as RuntimeUnit,
      label: "Watch",
      description: "Realtime link/route monitor.",
    },
    {
      key: "blockpage" as RuntimeUnit,
      label: "Blockpage HTTP",
      description: "HTTP block page service.",
    },
    {
      key: "blockpage-tls" as RuntimeUnit,
      label: "Blockpage TLS",
      description: "HTTPS block page service.",
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
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Overview</CardTitle>
            <CardDescription>Runtime health, apply, and verification controls.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void runRefresh()} disabled={loading}>
              Refresh
            </Button>
            <Button type="button" variant="secondary" onClick={() => void runVerify()} disabled={loading}>
              Verify
            </Button>
            <Button type="button" onClick={() => void runApply()} disabled={loading || !isOperator}>
              Apply
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Runtime status & management</CardTitle>
          <CardDescription>Monitor current state and control runtime units in one place.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-12">
          <section className="space-y-2 xl:col-span-4">
            {statusRows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Badge variant="outline" className="font-mono text-xs">{value}</Badge>
              </div>
            ))}
          </section>

          <section className="space-y-3 xl:col-span-8">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Global</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: "all", action: "enable-now" },
                      "Runtime stack enabled",
                    )
                  }
                  disabled={loading || !isOperator}
                >
                  Enable all
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: "all", action: "restart" },
                      "Runtime stack restarted",
                    )
                  }
                  disabled={loading || !isOperator}
                >
                  Restart all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "manage_unit", unit: "all", action: "disable-now" },
                      "Runtime stack disabled",
                    )
                  }
                  disabled={loading || !isOperator}
                >
                  Disable all
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    void runRuntimeOperation(
                      { operation: "disable_rules" },
                      "Rules disabled (nft table removed)",
                    )
                  }
                  disabled={loading || !isOperator}
                >
                  Disable rules
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per unit actions</p>
              <div className="space-y-2">
                {unitActions.map((unit) => (
                  <div
                    key={unit.key}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <h3 className="text-sm font-semibold">{unit.label}</h3>
                      <p className="text-xs text-muted-foreground">{unit.description}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          void runRuntimeOperation(
                            { operation: "manage_unit", unit: unit.key, action: "start" },
                            `${unit.label}: started`,
                          )
                        }
                        disabled={loading || !isOperator}
                      >
                        Start
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          void runRuntimeOperation(
                            { operation: "manage_unit", unit: unit.key, action: "stop" },
                            `${unit.label}: stopped`,
                          )
                        }
                        disabled={loading || !isOperator}
                      >
                        Stop
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          void runRuntimeOperation(
                            { operation: "manage_unit", unit: unit.key, action: "restart" },
                            `${unit.label}: restarted`,
                          )
                        }
                        disabled={loading || !isOperator}
                      >
                        Restart
                      </Button>
                      <Button
                        type="button"
                        size="xs"
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
                      >
                        Enable
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
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
                      >
                        Disable
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Danger zone</p>
              <p className="text-xs text-muted-foreground">
                Teardown removes VRKS runtime units and stops protection.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={teardownPurge}
                    onCheckedChange={(value) => setTeardownPurge(Boolean(value))}
                    id="teardown-purge"
                  />
                  <span>purge config/state</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={teardownRemoveBin}
                    onCheckedChange={(value) => setTeardownRemoveBin(Boolean(value))}
                    id="teardown-remove-bin"
                  />
                  <span>remove runtime binary</span>
                </label>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
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
                >
                  Run teardown
                </Button>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs">{output}</pre>
        </CardContent>
      </Card>
    </main>
  );
}
