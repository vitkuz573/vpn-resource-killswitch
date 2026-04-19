"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

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
          background: "#0f172a",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
          selectionBackground: "#334155",
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
      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">REPL</h1>
            <p className="text-sm text-slate-600">Full PTY sessions powered by xterm + node-pty with live stream.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshSessions()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Refresh sessions
            </button>
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={loading || !canUseRepl}
              className="rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              New session
            </button>
            <button
              type="button"
              onClick={() => void closeCurrentSession()}
              disabled={loading || !selectedSessionId || !canUseRepl}
              className="rounded-lg border border-rose-700 bg-rose-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
            >
              Close session
            </button>
          </div>
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-3">
        <h2 className="text-lg font-semibold">Session options</h2>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Shell
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={shellPath}
              onChange={(event) => setShellPath(event.target.value)}
              placeholder="/bin/bash"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            CWD
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={cwdPath}
              onChange={(event) => setCwdPath(event.target.value)}
              placeholder={"(home directory)"}
            />
          </label>
        </div>

        <h2 className="mt-5 text-lg font-semibold">Sessions</h2>
        <div className="mt-3 max-h-[52vh] space-y-2 overflow-auto">
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-600">No sessions yet.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void selectSession(session.id)}
                className={
                  selectedSessionId === session.id
                    ? "w-full rounded-lg border border-cyan-700 bg-cyan-50 p-2 text-left"
                    : "w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:bg-slate-100"
                }
              >
                <p className="text-xs font-semibold text-slate-900">{session.id.slice(0, 8)}</p>
                <p className="text-[11px] text-slate-600">{session.state}</p>
                <p className="text-[11px] text-slate-500">{session.shell}</p>
                <p className="truncate text-[11px] text-slate-500">{session.cwd}</p>
                <p className="text-[11px] text-slate-500">{formatDate(session.updatedAt)}</p>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="col-span-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-9">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Terminal</h2>
          <p className="text-xs text-slate-600">{selectedSession ? `${selectedSession.shell} @ ${selectedSession.cwd}` : "No session selected"}</p>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
          <div ref={terminalContainerRef} className="h-[70vh] min-h-[420px] w-full" />
        </div>

        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{status}</p>
      </section>
    </main>
  );
}
