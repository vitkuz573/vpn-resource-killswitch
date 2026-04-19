import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

export async function GET() {
  const specPath = join(process.cwd(), "openapi", "control-plane.openapi.json");
  const raw = await readFile(specPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return NextResponse.json(parsed);
}
