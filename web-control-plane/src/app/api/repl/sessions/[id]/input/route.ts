import { NextResponse } from "next/server";
import { z } from "zod";

import { getReplManager } from "@/lib/repl/manager";
import { replError, requireReplOperator } from "@/lib/repl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  data: z.string().min(1).max(16_384),
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

  let data: string;
  try {
    const payload = inputSchema.parse(await request.json());
    data = payload.data;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return replError(new Error(error.issues.map((item) => item.message).join(", ")), "Invalid input payload");
    }
    return replError(error, "Invalid input payload");
  }

  try {
    const manager = getReplManager();
    const session = manager.writeInput(id, data);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return replError(error, "Failed to write REPL input");
  }
}
