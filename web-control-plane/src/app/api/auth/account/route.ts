import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(254).optional(),
  currentPassword: z.string().min(8).max(256).optional(),
});

async function loadCurrentUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      passwordHash: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  const user = await loadCurrentUser(session.user.id);
  if (!user || !user.isActive) {
    return jsonError("Forbidden", 403);
  }

  return NextResponse.json({
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  let input: z.infer<typeof profileUpdateSchema>;
  try {
    const body = await request.json();
    input = profileUpdateSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid request payload", 400);
  }

  const user = await loadCurrentUser(session.user.id);
  if (!user || !user.isActive) {
    return jsonError("Forbidden", 403);
  }

  const nextName = input.name?.trim();
  const nextEmail = input.email?.trim().toLowerCase();

  const updates: { name?: string; email?: string } = {};
  const changedFields: string[] = [];

  if (nextName && nextName !== user.name) {
    updates.name = nextName;
    changedFields.push("name");
  }

  if (nextEmail && nextEmail !== user.email) {
    if (!input.currentPassword) {
      return jsonError("Current password is required to change email.", 400);
    }
    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) {
      return jsonError("Current password is incorrect.", 403);
    }

    const existing = await prisma.user.findUnique({
      where: { email: nextEmail },
      select: { id: true },
    });
    if (existing && existing.id !== user.id) {
      return jsonError("User with this email already exists.", 409);
    }

    updates.email = nextEmail;
    changedFields.push("email");
  }

  if (changedFields.length === 0) {
    return jsonError("No profile changes detected.", 400);
  }

  const requiresReauth = changedFields.includes("email");
  const updated = await prisma.$transaction(async (tx) => {
    const nextUser = await tx.user.update({
      where: { id: user.id },
      data: requiresReauth
        ? {
            ...updates,
            sessionVersion: { increment: 1 },
          }
        : updates,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (requiresReauth) {
      await tx.authSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: "email_changed",
        },
      });
    }

    return nextUser;
  });

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "account_profile_updated",
    target: user.id,
    payload: { changedFields },
  });

  return NextResponse.json({
    ok: true,
    profile: updated,
    requiresReauth,
  });
}
