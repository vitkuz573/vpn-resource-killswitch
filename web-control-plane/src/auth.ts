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
      if (user) {
        token.role = user.role;
        token.sub = user.id;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = typeof token.role === "string" ? token.role : "VIEWER";
      }
      return session;
    },
  },
});
