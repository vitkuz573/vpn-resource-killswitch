import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PROJECT_ROOT = path.resolve(process.cwd(), "..");
const VRKS_PROJECT_ROOT = process.env.VRKS_PROJECT_ROOT || DEFAULT_PROJECT_ROOT;
const VRKS_CLI_PATH = process.env.VRKS_CLI_PATH || path.join(VRKS_PROJECT_ROOT, "vrks.py");
const VRKS_PYTHON_BIN = process.env.VRKS_PYTHON_BIN || "python3";
const RAW_SUDO_MODE = (process.env.VRKS_SUDO_MODE || "").trim().toLowerCase();
type SudoMode = "auto" | "always" | "never";

function resolveSudoMode(): SudoMode {
  if (RAW_SUDO_MODE === "always" || RAW_SUDO_MODE === "auto" || RAW_SUDO_MODE === "never") {
    return RAW_SUDO_MODE;
  }
  return "auto";
}

const VRKS_SUDO_MODE = resolveSudoMode();

export type VrksCommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  argv: string[];
  usedSudo: boolean;
};

function buildCommand(args: string[], useSudo: boolean): { cmd: string; finalArgs: string[] } {
  const baseArgs = [VRKS_PYTHON_BIN, VRKS_CLI_PATH, ...args];
  if (useSudo) {
    return { cmd: "sudo", finalArgs: ["-n", ...baseArgs] };
  }
  return { cmd: baseArgs[0], finalArgs: baseArgs.slice(1) };
}

function isRootRequiredError(result: VrksCommandResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return text.includes("this command must run as root");
}

function isSudoAuthFailure(result: VrksCommandResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (!text.includes("sudo")) {
    return false;
  }
  return (
    text.includes("a password is required") ||
    text.includes("password is required") ||
    text.includes("terminal is required") ||
    text.includes("no tty present")
  );
}

function withSudoHint(result: VrksCommandResult): VrksCommandResult {
  if (!isSudoAuthFailure(result)) {
    return result;
  }
  const hint =
    "Sudo non-interactive auth is not configured for control plane. " +
    "Configure passwordless sudo for VRKS commands or run the control plane as root.";
  const merged = [result.stderr, hint].filter(Boolean).join("\n");
  return { ...result, stderr: merged };
}

async function runOnce(args: string[], timeoutMs: number, useSudo: boolean): Promise<VrksCommandResult> {
  const { cmd, finalArgs } = buildCommand(args, useSudo);

  try {
    const { stdout, stderr } = await execFileAsync(cmd, finalArgs, {
      cwd: VRKS_PROJECT_ROOT,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      env: process.env,
    });
    return {
      ok: true,
      code: 0,
      stdout: (stdout || "").trim(),
      stderr: (stderr || "").trim(),
      argv: [cmd, ...finalArgs],
      usedSudo: useSudo,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
      message?: string;
    };
    return {
      ok: false,
      code: typeof err.code === "number" ? err.code : 1,
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || err.message || "").trim(),
      argv: [cmd, ...finalArgs],
      usedSudo: useSudo,
    };
  }
}

async function runRaw(args: string[], timeoutMs = 30_000): Promise<VrksCommandResult> {
  if (VRKS_SUDO_MODE === "always") {
    return withSudoHint(await runOnce(args, timeoutMs, true));
  }
  if (VRKS_SUDO_MODE === "never") {
    return await runOnce(args, timeoutMs, false);
  }

  // auto: try without sudo first, then retry via sudo -n only when root is required.
  const first = await runOnce(args, timeoutMs, false);
  if (first.ok || !isRootRequiredError(first)) {
    return first;
  }
  return withSudoHint(await runOnce(args, timeoutMs, true));
}

export async function runVrksJson<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  const result = await runRaw(args, timeoutMs);
  if (!result.ok) {
    throw new Error(
      `VRKS command failed (exit=${result.code}): ${result.argv.join(" ")}\n${result.stderr || result.stdout}`,
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`VRKS command did not return valid JSON: ${result.argv.join(" ")}`);
  }
}

export async function runVrksText(args: string[], timeoutMs = 30_000): Promise<VrksCommandResult> {
  return runRaw(args, timeoutMs);
}
