import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(256),
    newPassword: z.string().min(10).max(256),
    confirmPassword: z.string().min(10).max(256),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must differ from current password",
    path: ["newPassword"],
  });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }

  let input: z.infer<typeof updatePasswordSchema>;
  try {
    const body = await request.json();
    input = updatePasswordSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid request payload", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      isActive: true,
      passwordHash: true,
    },
  });
  if (!user || !user.isActive) {
    return jsonError("Forbidden", 403);
  }

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) {
    return jsonError("Current password is incorrect.", 403);
  }

  const newPasswordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        sessionVersion: { increment: 1 },
      },
    });

    await tx.authSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: "password_changed",
      },
    });
  });

  await writeAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "account_password_updated",
    target: user.id,
    payload: { email: user.email },
  });

  return NextResponse.json({
    ok: true,
    requiresReauth: true,
    message: "Password updated.",
  });
}
