import { NextResponse } from "next/server";
import { z } from "zod";

import { getReplManager } from "@/lib/repl/manager";
import { replError, requireReplOperator } from "@/lib/repl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resizeSchema = z.object({
  cols: z.number().int().min(20).max(320),
  rows: z.number().int().min(8).max(120),
});

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await params;

  let cols: number;
  let rows: number;

  try {
    const payload = resizeSchema.parse(await request.json());
    cols = payload.cols;
    rows = payload.rows;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return replError(new Error(error.issues.map((item) => item.message).join(", ")), "Invalid resize payload");
    }
    return replError(error, "Invalid resize payload");
  }

  try {
    const manager = getReplManager();
    const session = manager.resize(id, cols, rows);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return replError(error, "Failed to resize REPL session");
  }
}
