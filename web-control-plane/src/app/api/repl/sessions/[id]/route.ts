import { NextResponse } from "next/server";

import { writeAudit } from "@/lib/audit";
import { getReplManager } from "@/lib/repl/manager";
import { replError, requireReplOperator } from "@/lib/repl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await params;

  try {
    const manager = getReplManager();
    const session = manager.getPublic(id);
    const backlog = manager.getBacklog(id);
    return NextResponse.json({
      session,
      backlog,
    });
  } catch (error) {
    return replError(error, "Failed to read REPL session");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await params;

  try {
    const manager = getReplManager();
    const session = manager.close(id);

    await writeAudit({
      actorId: access.session.user.id,
      actorEmail: access.session.user.email,
      action: "repl_session_close",
      target: session.id,
      payload: {
        state: session.state,
        exitCode: session.exitCode,
        signal: session.signal,
      },
    });

    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return replError(error, "Failed to close REPL session");
  }
}
