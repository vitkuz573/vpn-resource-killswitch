import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { jsonError } from "@/lib/http";
import { runVrksText } from "@/lib/vrks-cli";

const verifySchema = z.object({
  timeout: z.number().int().min(3).max(60).default(8),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  let timeout = 8;
  try {
    const raw = await request.json().catch(() => ({}));
    timeout = verifySchema.parse(raw).timeout;
  } catch {
    return jsonError("Invalid timeout value", 400);
  }

  const result = await runVrksText(["verify", "--timeout", String(timeout)], 90_000);
  return NextResponse.json({
    ok: result.ok,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}
