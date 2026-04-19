import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET() {
  const usersCount = await prisma.user.count();
  return NextResponse.json({
    bootstrapRequired: usersCount === 0,
    usersCount,
  });
}
