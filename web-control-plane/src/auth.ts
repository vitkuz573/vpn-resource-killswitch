import { randomUUID } from "node:crypto";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { canAttempt, registerFailure, registerSuccess } from "@/lib/auth/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});

const PROFILE_SYNC_INTERVAL_MS = 60_000;
const SESSION_SYNC_INTERVAL_MS = 20_000;

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.trim().toLowerCase();
        const password = parsed.data.password;

        const throttle = canAttempt(email);
        if (!throttle.ok) {
          throw new Error(`Too many attempts. Retry in ${throttle.retryInSeconds}s.`);
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          registerFailure(email);
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          registerFailure(email);
          return null;
        }

        registerSuccess(email);

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const userAgent = normalizeHeaderValue(request.headers.get("user-agent"));
        const ipAddress = extractIpFromHeaders(request.headers);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
          loginUserAgent: userAgent,
          loginIpAddress: ipAddress,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      const now = Date.now();

      if (user) {
        const userId = typeof user.id === "string" ? user.id : "";
        if (!userId) {
          return token;
        }
        const sessionId = randomUUID();
        const userAgent = typeof user.loginUserAgent === "string" ? user.loginUserAgent : null;
        const ipAddress = typeof user.loginIpAddress === "string" ? user.loginIpAddress : null;
        const sessionVersion = typeof user.sessionVersion === "number" ? user.sessionVersion : 0;

        token.role = user.role;
        token.sub = userId;
        token.name = user.name;
        token.email = user.email;
        token.sid = sessionId;
        token.sessionVersion = sessionVersion;
        token.profileSyncAt = now;
        token.sessionSyncAt = now;

        await prisma.authSession.upsert({
          where: { sessionId },
          update: {
            lastSeenAt: new Date(),
            revokedAt: null,
            revokedReason: null,
            userAgent,
            ipAddress,
          },
          create: {
            sessionId,
            userId,
            userAgent,
            ipAddress,
          },
        });

        await prisma.authLoginEvent.create({
          data: {
            userId,
            method: "credentials",
            success: true,
            userAgent,
            ipAddress,
            sessionId,
          },
        });

        return token;
      }

      const userId = typeof token.sub === "string" ? token.sub : "";
      const sessionId = typeof token.sid === "string" ? token.sid : "";
      const tokenSessionVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      const lastProfileSync = typeof token.profileSyncAt === "number" ? token.profileSyncAt : 0;
      const lastSessionSync = typeof token.sessionSyncAt === "number" ? token.sessionSyncAt : 0;

      if (!userId || !sessionId) {
        return token;
      }

      const shouldSyncProfile = now - lastProfileSync >= PROFILE_SYNC_INTERVAL_MS;
      const shouldSyncSession = now - lastSessionSync >= SESSION_SYNC_INTERVAL_MS;
      if (!shouldSyncProfile && !shouldSyncSession) {
        return token;
      }

      const [dbUser, dbSession] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            name: true,
            email: true,
            role: true,
            isActive: true,
            sessionVersion: true,
          },
        }),
        prisma.authSession.findUnique({
          where: { sessionId },
          select: {
            userId: true,
            revokedAt: true,
          },
        }),
      ]);

      const invalid =
        !dbUser ||
        !dbUser.isActive ||
        dbUser.sessionVersion !== tokenSessionVersion ||
        !dbSession ||
        dbSession.userId !== userId ||
        Boolean(dbSession.revokedAt);

      if (invalid) {
        token.sub = "";
        token.role = "VIEWER";
        token.name = undefined;
        token.email = undefined;
        token.sid = undefined;
        token.sessionVersion = undefined;
        token.profileSyncAt = now;
        token.sessionSyncAt = now;
        return token;
      }

      if (shouldSyncProfile) {
        token.profileSyncAt = now;
        token.role = dbUser.role;
        token.name = dbUser.name;
        token.email = dbUser.email;
      }

      if (shouldSyncSession) {
        token.sessionSyncAt = now;
        await prisma.authSession.update({
          where: { sessionId },
          data: { lastSeenAt: new Date() },
        });
      }

      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = typeof token.role === "string" ? token.role : "VIEWER";
        if (typeof token.name === "string") {
          session.user.name = token.name;
        }
        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
        if (typeof token.sid === "string") {
          session.user.sessionId = token.sid;
        }
      }
      return session;
    },
  },
});
