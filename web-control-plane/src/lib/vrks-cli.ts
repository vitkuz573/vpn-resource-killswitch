import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PROJECT_ROOT = path.resolve(process.cwd(), "..");
const VRKS_PROJECT_ROOT = process.env.VRKS_PROJECT_ROOT || DEFAULT_PROJECT_ROOT;
const VRKS_CLI_PATH = process.env.VRKS_CLI_PATH || path.join(VRKS_PROJECT_ROOT, "vrks.py");
const VRKS_PYTHON_BIN = process.env.VRKS_PYTHON_BIN || "python3";
const VRKS_REQUIRE_SUDO = process.env.VRKS_REQUIRE_SUDO === "true";

export type VrksCommandResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  argv: string[];
};

async function runRaw(args: string[], timeoutMs = 30_000): Promise<VrksCommandResult> {
  const baseArgs = [VRKS_PYTHON_BIN, VRKS_CLI_PATH, ...args];
  const cmd = VRKS_REQUIRE_SUDO ? "sudo" : baseArgs[0];
  const finalArgs = VRKS_REQUIRE_SUDO ? ["-n", ...baseArgs] : baseArgs.slice(1);

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
    };
  }
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
