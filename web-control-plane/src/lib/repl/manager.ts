import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawn, type IPty } from "node-pty";

const MAX_SESSIONS = 8;
const MAX_BACKLOG_CHARS = 400_000;

export type ReplSessionState = "running" | "exited";

export type ReplSessionPublic = {
  id: string;
  createdAt: string;
  updatedAt: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  state: ReplSessionState;
  exitCode: number | null;
  signal: number | null;
};

export type ReplStreamEvent =
  | {
      type: "output";
      at: string;
      chunk: string;
    }
  | {
      type: "state";
      at: string;
      state: ReplSessionState;
      exitCode: number | null;
      signal: number | null;
    };

type StreamListener = (event: ReplStreamEvent) => void;

type CreateSessionInput = {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeShell(value: string | undefined): string {
  const fallback = process.env.SHELL || "/bin/bash";
  const shell = (value || fallback).trim();
  if (!shell) {
    return fallback;
  }
  if (!path.isAbsolute(shell)) {
    return fallback;
  }
  if (!fs.existsSync(shell)) {
    return fallback;
  }
  return shell;
}

function normalizeCwd(value: string | undefined): string {
  const home = os.homedir();
  const raw = (value || home).trim();
  if (!raw) {
    return home;
  }
  const target = path.resolve(raw);
  if (!fs.existsSync(target)) {
    return home;
  }
  try {
    if (!fs.statSync(target).isDirectory()) {
      return home;
    }
  } catch {
    return home;
  }
  return target;
}

class ReplSession {
  readonly id: string;
  readonly shell: string;
  readonly cwd: string;

  private pty: IPty;
  private createdAt: string;
  private updatedAt: string;
  private cols: number;
  private rows: number;
  private state: ReplSessionState;
  private exitCode: number | null;
  private signal: number | null;
  private backlog: string;
  private listeners: Set<StreamListener>;

  constructor(input: CreateSessionInput) {
    this.id = randomUUID();
    this.shell = normalizeShell(input.shell);
    this.cwd = normalizeCwd(input.cwd);
    this.cols = clamp(Math.floor(input.cols ?? 120), 20, 320);
    this.rows = clamp(Math.floor(input.rows ?? 32), 8, 120);
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    this.state = "running";
    this.exitCode = null;
    this.signal = null;
    this.backlog = "";
    this.listeners = new Set();

    this.pty = spawn(this.shell, [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    this.pty.onData((chunk) => {
      this.updatedAt = nowIso();
      this.appendBacklog(chunk);
      this.emit({
        type: "output",
        at: this.updatedAt,
        chunk,
      });
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.updatedAt = nowIso();
      this.state = "exited";
      this.exitCode = exitCode ?? null;
      this.signal = signal ?? null;
      this.emit({
        type: "state",
        at: this.updatedAt,
        state: this.state,
        exitCode: this.exitCode,
        signal: this.signal,
      });
    });
  }

  private appendBacklog(chunk: string): void {
    if (!chunk) {
      return;
    }
    this.backlog += chunk;
    if (this.backlog.length > MAX_BACKLOG_CHARS) {
      this.backlog = this.backlog.slice(this.backlog.length - MAX_BACKLOG_CHARS);
    }
  }

  private emit(event: ReplStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  toPublic(): ReplSessionPublic {
    return {
      id: this.id,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      shell: this.shell,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      state: this.state,
      exitCode: this.exitCode,
      signal: this.signal,
    };
  }

  getBacklog(): string {
    return this.backlog;
  }

  writeInput(data: string): void {
    if (this.state !== "running") {
      throw new Error("Session is not running");
    }
    this.updatedAt = nowIso();
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = clamp(Math.floor(cols), 20, 320);
    this.rows = clamp(Math.floor(rows), 8, 120);
    if (this.state === "running") {
      this.pty.resize(this.cols, this.rows);
    }
    this.updatedAt = nowIso();
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    if (this.state === "running") {
      this.pty.kill();
    }
  }
}

class ReplManager {
  private sessions: Map<string, ReplSession>;

  constructor() {
    this.sessions = new Map();
  }

  list(): ReplSessionPublic[] {
    return [...this.sessions.values()]
      .map((session) => session.toPublic())
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  create(input: CreateSessionInput): ReplSessionPublic {
    if (this.sessions.size >= MAX_SESSIONS) {
      const exited = [...this.sessions.values()]
        .filter((session) => session.toPublic().state === "exited")
        .sort((a, b) => (a.toPublic().updatedAt < b.toPublic().updatedAt ? -1 : 1));
      if (exited.length > 0) {
        this.sessions.delete(exited[0].toPublic().id);
      }
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`Too many active REPL sessions (max ${MAX_SESSIONS})`);
    }

    const session = new ReplSession(input);
    this.sessions.set(session.id, session);
    return session.toPublic();
  }

  get(id: string): ReplSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error("Session not found");
    }
    return session;
  }

  getPublic(id: string): ReplSessionPublic {
    return this.get(id).toPublic();
  }

  getBacklog(id: string): string {
    return this.get(id).getBacklog();
  }

  writeInput(id: string, data: string): ReplSessionPublic {
    const session = this.get(id);
    session.writeInput(data);
    return session.toPublic();
  }

  resize(id: string, cols: number, rows: number): ReplSessionPublic {
    const session = this.get(id);
    session.resize(cols, rows);
    return session.toPublic();
  }

  subscribe(id: string, listener: StreamListener): () => void {
    return this.get(id).subscribe(listener);
  }

  close(id: string): ReplSessionPublic {
    const session = this.get(id);
    session.close();
    const snapshot = session.toPublic();
    this.sessions.delete(id);
    return snapshot;
  }
}

declare global {
  var __vrksReplManager: ReplManager | undefined;
}

export function getReplManager(): ReplManager {
  if (!globalThis.__vrksReplManager) {
    globalThis.__vrksReplManager = new ReplManager();
  }
  return globalThis.__vrksReplManager;
}
