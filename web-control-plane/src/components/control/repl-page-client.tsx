"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseResponse } from "@/lib/control-plane-client";

type Props = {
  userRole: string;
};

type ReplSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  state: "running" | "exited";
  exitCode: number | null;
  signal: number | null;
};

type ReplSessionsResponse = {
  sessions: ReplSession[];
};

type ReplStreamInit = {
  session: ReplSession;
  backlog: string;
};

type ReplStreamOutput = {
  type: "output";
  at: string;
  chunk: string;
};

type ReplStreamState = {
  type: "state";
  at: string;
  state: "running" | "exited";
  exitCode: number | null;
  signal: number | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function ReplPageClient({ userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ReplSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [shellPath, setShellPath] = useState("/bin/bash");
  const [cwdPath, setCwdPath] = useState("");

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const streamTokenRef = useRef(0);

  const inputBufferRef = useRef("");
  const inputFlushInFlightRef = useRef(false);
  const resizeDebounceRef = useRef<number | null>(null);

  const canUseRepl = userRole === "ADMIN" || userRole === "OPERATOR";

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  async function refreshSessions(): Promise<ReplSession[]> {
    const response = await fetch("/api/repl/sessions", { cache: "no-store" });
    const data = await parseResponse<ReplSessionsResponse>(response);
    setSessions(data.sessions || []);
    return data.sessions || [];
  }

  async function flushInputBuffer(): Promise<void> {
    const sessionId = selectedSessionIdRef.current;
    if (!sessionId || inputFlushInFlightRef.current || !inputBufferRef.current) {
      return;
    }

    inputFlushInFlightRef.current = true;
    const chunk = inputBufferRef.current;
    inputBufferRef.current = "";

    try {
      await fetch(`/api/repl/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: chunk }),
      });
    } catch {
      terminalRef.current?.writeln("\r\n[vrks-repl] failed to send input to backend\r\n");
    } finally {
      inputFlushInFlightRef.current = false;
      if (inputBufferRef.current) {
        void flushInputBuffer();
      }
    }
  }

  async function sendResize(cols: number, rows: number): Promise<void> {
    const sessionId = selectedSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    try {
      await fetch(`/api/repl/sessions/${encodeURIComponent(sessionId)}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols, rows }),
      });
    } catch {
      // ignore resize errors
    }
  }

  function scheduleResizeSync(): void {
    if (!fitAddonRef.current || !terminalRef.current) {
      return;
    }

    fitAddonRef.current.fit();

    const cols = terminalRef.current.cols;
    const rows = terminalRef.current.rows;

    if (resizeDebounceRef.current !== null) {
      window.clearTimeout(resizeDebounceRef.current);
    }

    resizeDebounceRef.current = window.setTimeout(() => {
      resizeDebounceRef.current = null;
      void sendResize(cols, rows);
    }, 80);
  }

  function closeStream(): void {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function attachStream(sessionId: string): void {
    closeStream();

    const token = ++streamTokenRef.current;
    const source = new EventSource(`/api/repl/sessions/${encodeURIComponent(sessionId)}/stream`);
    eventSourceRef.current = source;

    source.addEventListener("init", (event) => {
      if (token !== streamTokenRef.current) {
        return;
      }

      const payload = JSON.parse((event as MessageEvent).data) as ReplStreamInit;
      terminalRef.current?.clear();
      if (payload.backlog) {
        terminalRef.current?.write(payload.backlog);
      }

      setStatus(`Attached to session ${payload.session.id.slice(0, 8)} (${payload.session.state})`);
      setSessions((previous) => {
        const filtered = previous.filter((item) => item.id !== payload.session.id);
        return [payload.session, ...filtered];
      });
      scheduleResizeSync();
    });

    source.addEventListener("output", (event) => {
      if (token !== streamTokenRef.current) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as ReplStreamOutput;
      if (payload.chunk) {
        terminalRef.current?.write(payload.chunk);
      }
    });

    source.addEventListener("state", (event) => {
      if (token !== streamTokenRef.current) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as ReplStreamState;
      setStatus(
        `Session ${sessionId.slice(0, 8)} ${payload.state} (exit=${payload.exitCode ?? "-"}, signal=${payload.signal ?? "-"})`,
      );
      setSessions((previous) =>
        previous.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                state: payload.state,
                exitCode: payload.exitCode,
                signal: payload.signal,
                updatedAt: payload.at,
              }
            : item,
        ),
      );
    });

    source.onerror = () => {
      if (token !== streamTokenRef.current) {
        return;
      }
      setStatus("REPL stream interrupted");
    };
  }

  async function selectSession(id: string): Promise<void> {
    setSelectedSessionId(id);
    selectedSessionIdRef.current = id;
    setStatus(`Connecting to ${id.slice(0, 8)}...`);
    attachStream(id);
  }

  async function createSession(): Promise<void> {
    if (!canUseRepl) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/repl/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shell: shellPath || undefined,
          cwd: cwdPath || undefined,
          cols: terminalRef.current?.cols || 120,
          rows: terminalRef.current?.rows || 32,
        }),
      });

      const data = await parseResponse<{ ok: boolean; session: ReplSession }>(response);
      await refreshSessions();
      await selectSession(data.session.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  }

  async function closeCurrentSession(): Promise<void> {
    const sessionId = selectedSessionIdRef.current;
    if (!sessionId || !canUseRepl) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/repl/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      await parseResponse(response);

      closeStream();
      setSelectedSessionId(null);
      selectedSessionIdRef.current = null;
      terminalRef.current?.clear();

      const next = await refreshSessions();
      if (next.length > 0) {
        await selectSession(next[0].id);
      } else {
        setStatus("No active REPL sessions");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to close session");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (!mounted || !terminalContainerRef.current) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 13,
        lineHeight: 1.28,
        theme: {
          background: "#0b0f19",
          foreground: "#e2e8f0",
          cursor: "#8b95a7",
          selectionBackground: "#253043",
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalContainerRef.current);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      scheduleResizeSync();

      terminal.writeln("VRKS REPL ready. Create session to start.\r");

      terminal.onData((chunk) => {
        if (!selectedSessionIdRef.current) {
          return;
        }
        inputBufferRef.current += chunk;
        void flushInputBuffer();
      });

      const observer = new ResizeObserver(() => {
        scheduleResizeSync();
      });
      observer.observe(terminalContainerRef.current);

      window.addEventListener("resize", scheduleResizeSync);

      try {
        const existing = await refreshSessions();
        if (existing.length > 0) {
          await selectSession(existing[0].id);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to bootstrap REPL");
      }

      return () => {
        observer.disconnect();
        window.removeEventListener("resize", scheduleResizeSync);
      };
    };

    let cleanup: (() => void) | undefined;
    void setup().then((fn) => {
      cleanup = fn;
    });

    return () => {
      mounted = false;
      if (cleanup) {
        cleanup();
      }
      closeStream();
      if (resizeDebounceRef.current !== null) {
        window.clearTimeout(resizeDebounceRef.current);
      }
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">REPL</CardTitle>
            <CardDescription>Interactive terminal sessions with live stream and session control.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshSessions()} disabled={loading}>
              Refresh sessions
            </Button>
            <Button type="button" onClick={() => void createSession()} disabled={loading || !canUseRepl}>
              New session
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void closeCurrentSession()}
              disabled={loading || !selectedSessionId || !canUseRepl}
            >
              Close session
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card className="col-span-12 md:col-span-3">
        <CardHeader>
          <CardTitle>Session options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repl-shell">Shell</Label>
            <Input
              id="repl-shell"
              value={shellPath}
              onChange={(event) => setShellPath(event.target.value)}
              placeholder="/bin/bash"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repl-cwd">CWD</Label>
            <Input
              id="repl-cwd"
              value={cwdPath}
              onChange={(event) => setCwdPath(event.target.value)}
              placeholder="(home directory)"
            />
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Sessions</h2>
            <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions yet.</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void selectSession(session.id)}
                    className={
                      selectedSessionId === session.id
                        ? "w-full rounded-lg border border-primary/40 bg-primary/10 p-2 text-left"
                        : "w-full rounded-lg border bg-muted/20 p-2 text-left hover:bg-muted/40"
                    }
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold">{session.id.slice(0, 8)}</p>
                      <Badge variant={session.state === "running" ? "secondary" : "outline"}>
                        {session.state}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{session.shell}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{session.cwd}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(session.updatedAt)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="col-span-12 md:col-span-9">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Terminal</CardTitle>
          <p className="text-xs text-muted-foreground">
            {selectedSession ? `${selectedSession.shell} @ ${selectedSession.cwd}` : "No session selected"}
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border bg-[#0b0f19]">
            <div ref={terminalContainerRef} className="h-[70vh] min-h-[420px] w-full" />
          </div>

          <p className="mt-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{status}</p>
        </CardContent>
      </Card>
    </main>
  );
}
