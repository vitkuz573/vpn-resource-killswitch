import type { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { jsonError } from "@/lib/http";

type ReplSessionUser = {
  id: string;
  email?: string | null;
  role?: string | null;
};

export type ReplAuthedSession = {
  user: ReplSessionUser;
};

export type ReplAuthResult =
  | {
      ok: true;
      session: ReplAuthedSession;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireReplOperator(): Promise<ReplAuthResult> {
  const session = (await auth()) as { user?: ReplSessionUser } | null;
  if (!session?.user?.id) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }
  if (!hasRole(session.user.role, "OPERATOR")) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true, session: { user: session.user } };
}

export function replError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof Error) {
    if (error.message.includes("Session not found")) {
      return jsonError("REPL session not found", 404);
    }
    if (error.message.includes("Too many active REPL sessions")) {
      return jsonError(error.message, 429);
    }
    if (error.message.includes("Session is not running")) {
      return jsonError(error.message, 409);
    }
    return jsonError(error.message, 400);
  }
  return jsonError(fallbackMessage, 500);
}
