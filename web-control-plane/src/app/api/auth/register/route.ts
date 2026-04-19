import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { hashPassword } from "@/lib/auth/password";
import { hasRole } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(254),
    password: z.string().min(10).max(256),
    confirmPassword: z.string().min(10).max(256),
    role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  let input: z.infer<typeof registerSchema>;
  try {
    const body = await request.json();
    input = registerSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((item) => item.message).join(", "), 400);
    }
    return jsonError("Invalid request payload", 400);
  }

  const usersCount = await prisma.user.count();
  const bootstrap = usersCount === 0;

  const session = await auth();
  if (!bootstrap) {
    if (!session?.user?.id) {
      return jsonError("Unauthorized", 401);
    }
    if (!hasRole(session.user.role, "ADMIN")) {
      return jsonError("Forbidden", 403);
    }
  }

  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return jsonError("User with this email already exists.", 409);
  }

  const role: UserRole = bootstrap ? "ADMIN" : (input.role ?? "VIEWER");
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email,
      passwordHash,
      role,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  await writeAudit({
    actorId: session?.user?.id ?? user.id,
    actorEmail: session?.user?.email ?? user.email,
    action: bootstrap ? "bootstrap_admin_created" : "user_created",
    target: user.id,
    payload: { email: user.email, role: user.role },
  });

  return NextResponse.json({
    ok: true,
    bootstrap,
    user,
  });
}
