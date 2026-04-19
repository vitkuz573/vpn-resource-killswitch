import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const sessionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("revoke"),
    sessionId: z.string().min(4).max(128),
  }),
  z.object({
    action: z.literal("revoke_others"),
  }),
  z.object({
    action: z.literal("revoke_all"),
  }),
]);

function normalizeHeaderValue(value: string | null, max = 512): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, max);
}

function extractIpFromHeaders(headers: Headers): string | null {
  const xff = normalizeHeaderValue(headers.get("x-forwarded-for"), 256);
  if (xff) {
    const first = xff.split(",")[0]?.trim() || "";
    return first || null;
  }
  return normalizeHeaderValue(headers.get("x-real-ip"), 128);
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const currentSessionId = session.user.sessionId || null;
  if (currentSessionId) {
    await prisma.authSession.upsert({
      where: { sessionId: currentSessionId },
      update: {
        lastSeenAt: new Date(),
        userAgent: normalizeHeaderValue(request.headers.get("user-agent")),
        ipAddress: extractIpFromHeaders(request.headers),
      },
      create: {
        sessionId: currentSessionId,
        userId: session.user.id,
        userAgent: normalizeHeaderValue(request.headers.get("user-agent")),
        ipAddress: extractIpFromHeaders(request.headers),
      },
    });
  }

  const [activeSessions, recentLogins] = await Promise.all([
    prisma.authSession.findMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
      },
      orderBy: { lastSeenAt: "desc" },
      take: 30,
      select: {
        sessionId: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastSeenAt: true,
      },
    }),
    prisma.authLoginEvent.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        method: true,
        success: true,
        userAgent: true,
        ipAddress: true,
        sessionId: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    currentSessionId,
    activeSessions,
    recentLogins,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  let input: z.infer<typeof sessionActionSchema>;
  try {
    const body = await request.json();
    input = sessionActionSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid request payload", 400);
  }

  const currentSessionId = session.user.sessionId || null;
  const now = new Date();
  let revokedCount = 0;
  let requiresReauth = false;

  if (input.action === "revoke_others") {
    const result = await prisma.authSession.updateMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
        ...(currentSessionId ? { sessionId: { not: currentSessionId } } : {}),
      },
      data: {
        revokedAt: now,
        revokedReason: "user_revoke_others",
      },
    });
    revokedCount = result.count;
  } else if (input.action === "revoke_all") {
    const result = await prisma.authSession.updateMany({
      where: {
        userId: session.user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokedReason: "user_revoke_all",
      },
    });
    revokedCount = result.count;
    requiresReauth = true;
  } else {
    const result = await prisma.authSession.updateMany({
      where: {
        userId: session.user.id,
        sessionId: input.sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokedReason: "user_revoke_session",
      },
    });
    revokedCount = result.count;
    requiresReauth = currentSessionId === input.sessionId && revokedCount > 0;
  }

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "account_sessions_updated",
    target: session.user.id,
    payload: {
      action: input.action,
      currentSessionId,
      revokedCount,
      revokeTargetSessionId: input.action === "revoke" ? input.sessionId : null,
    },
  });

  return NextResponse.json({
    ok: true,
    action: input.action,
    revokedCount,
    requiresReauth,
  });
}
