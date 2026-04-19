import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/http";
import { runVrksJson } from "@/lib/vrks-cli";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const status = await runVrksJson<Record<string, unknown>>(["status", "--json"]);
    return NextResponse.json({ status });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to fetch VRKS status", 500);
  }
}
