"use client";

import { useEffect, useMemo, useState } from "react";

import { parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type Preset = {
  name: string;
  description: string;
  domains: string[];
};

export function PresetsPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [output, setOutput] = useState("(idle)");

  const isOperator = userRole === "ADMIN" || userRole === "OPERATOR";

  async function refreshPresets(): Promise<void> {
    const response = await fetch("/api/control/presets", { cache: "no-store" });
    const data = await parseResponse<{ presets: Preset[] }>(response);
    const items = data.presets || [];
    setPresets(items);
    if (!presetName && items.length > 0) {
      setPresetName(items[0].name);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshPresets().catch((error: unknown) => {
        setOutput(error instanceof Error ? error.message : "Failed to load presets");
      });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPreset = useMemo(() => presets.find((item) => item.name === presetName), [presets, presetName]);

  async function applyPreset(): Promise<void> {
    if (!isOperator || !presetName) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/control/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: presetName }),
      });
      const data = await parseResponse<{ stdout?: string }>(response);
      setOutput(data.stdout || `Preset ${presetName} applied.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Preset apply failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid grid-cols-12 gap-4">
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Presets</h1>
            <p className="text-sm text-slate-600">Apply ready-to-use resource profile sets.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPresets()}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            Refresh presets
          </button>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-7">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="text-sm font-medium text-slate-700">Preset</label>
            <select
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
            disabled={loading || !isOperator || !presetName}
            className="rounded-lg border border-amber-600 bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Apply preset
          </button>
        </div>

        {selectedPreset ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">{selectedPreset.description}</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domains ({selectedPreset.domains.length})</p>
              <p className="mt-1 break-all text-xs text-slate-700">{selectedPreset.domains.join(", ")}</p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">No preset selected.</p>
        )}
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-5">
        <h2 className="text-lg font-semibold">Output</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output}</pre>
      </section>
    </main>
  );
}
