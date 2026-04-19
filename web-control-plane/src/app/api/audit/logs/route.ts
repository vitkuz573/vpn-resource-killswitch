import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/roles";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  actor: z.string().trim().max(254).optional(),
  action: z.string().trim().max(120).optional(),
  target: z.string().trim().max(254).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
  export: z.enum(["1", "true"]).optional(),
});

function parsePayload(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasRole(session.user.role, "ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((item) => item.message).join(", "), 400);
  }
  const query = parsed.data;

  const and: Prisma.AuditLogWhereInput[] = [];
  if (query.actor) {
    and.push({ actorEmail: { contains: query.actor } });
  }
  if (query.action) {
    and.push({ action: { contains: query.action } });
  }
  if (query.target) {
    and.push({ target: { contains: query.target } });
  }
  if (query.q) {
    and.push({
      OR: [
        { actorEmail: { contains: query.q } },
        { action: { contains: query.q } },
        { target: { contains: query.q } },
        { payload: { contains: query.q } },
      ],
    });
  }
  if (query.from || query.to) {
    and.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }

  const where: Prisma.AuditLogWhereInput = and.length > 0 ? { AND: and } : {};

  if (query.export) {
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        action: true,
        target: true,
        payload: true,
        createdAt: true,
      },
    });
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      count: rows.length,
      items: rows.map((row) => ({
        ...row,
        payloadParsed: parsePayload(row.payload),
      })),
    });
  }

  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        action: true,
        target: true,
        payload: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    items: rows.map((row) => ({
      ...row,
      payloadParsed: parsePayload(row.payload),
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  });
}
