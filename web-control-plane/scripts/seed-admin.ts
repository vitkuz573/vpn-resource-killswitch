import { UserRole } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = (process.env.ADMIN_NAME || "Admin").trim();

  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.");
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        name,
        role: UserRole.ADMIN,
        isActive: true,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Updated ADMIN user: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: UserRole.ADMIN,
        isActive: true,
      },
    });
    console.log(`Created ADMIN user: ${email}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
