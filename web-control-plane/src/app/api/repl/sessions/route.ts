import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { getReplManager } from "@/lib/repl/manager";
import { replError, requireReplOperator } from "@/lib/repl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  shell: z.string().trim().min(1).max(512).optional(),
  cwd: z.string().trim().min(1).max(2048).optional(),
  cols: z.number().int().min(20).max(320).optional(),
  rows: z.number().int().min(8).max(120).optional(),
});

export async function GET() {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  try {
    const manager = getReplManager();
    return NextResponse.json({
      sessions: manager.list(),
    });
  } catch (error) {
    return replError(error, "Failed to list REPL sessions");
  }
}

export async function POST(request: Request) {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  let input: z.infer<typeof createSchema>;
  try {
    const raw = await request.json().catch(() => ({}));
    input = createSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return replError(new Error(error.issues.map((item) => item.message).join(", ")), "Invalid payload");
    }
    return replError(error, "Invalid payload");
  }

  try {
    const manager = getReplManager();
    const session = manager.create(input);

    await writeAudit({
      actorId: access.session.user.id,
      actorEmail: access.session.user.email,
      action: "repl_session_create",
      target: session.id,
      payload: {
        shell: session.shell,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
      },
    });

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return replError(error, "Failed to create REPL session");
  }
}
