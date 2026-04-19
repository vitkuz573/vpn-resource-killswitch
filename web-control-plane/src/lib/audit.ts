import { prisma } from "@/lib/prisma";

type AuditInput = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  payload?: unknown;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  const payload = input.payload === undefined ? undefined : JSON.stringify(input.payload);
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      target: input.target ?? null,
      payload,
    },
  });
}
