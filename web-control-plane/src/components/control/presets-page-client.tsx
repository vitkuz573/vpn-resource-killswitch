"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const selectedPreset = useMemo(
    () => presets.find((item) => item.name === presetName),
    [presets, presetName],
  );

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
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Presets</CardTitle>
            <CardDescription>Apply ready-to-use resource profile sets.</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={() => void refreshPresets()} disabled={loading}>
            Refresh presets
          </Button>
        </CardHeader>
      </Card>

      <Card className="col-span-12 md:col-span-7">
        <CardHeader>
          <CardTitle>Preset selection</CardTitle>
          <CardDescription>Pick a preset and apply it to resource profiles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-2">
              <p className="text-sm font-medium">Preset</p>
              <Select value={presetName} onValueChange={(value) => setPresetName(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => void applyPreset()}
              disabled={loading || !isOperator || !presetName}
            >
              Apply preset
            </Button>
          </div>

          {selectedPreset ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{selectedPreset.name}</Badge>
                <Badge variant="outline">domains: {selectedPreset.domains.length}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{selectedPreset.description}</p>
              <p className="max-h-40 overflow-auto break-all rounded-md border bg-background p-2 font-mono text-xs">
                {selectedPreset.domains.join(", ")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No preset selected.</p>
          )}
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-5">
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
