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
      authorize: async (credentials) => {
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

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      const now = Date.now();
      if (user) {
        token.role = user.role;
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
        token.profileSyncAt = now;
        return token;
      }

      const userId = typeof token.sub === "string" ? token.sub : "";
      const lastSync = typeof token.profileSyncAt === "number" ? token.profileSyncAt : 0;
      if (!userId || now - lastSync < 60_000) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      });
      token.profileSyncAt = now;
      if (dbUser?.isActive) {
        token.role = dbUser.role;
        token.name = dbUser.name;
        token.email = dbUser.email;
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
      }
      return session;
    },
  },
});
