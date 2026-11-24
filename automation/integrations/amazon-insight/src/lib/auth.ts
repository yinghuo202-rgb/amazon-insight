import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { signSessionToken, verifySignedSessionCookie } from "@/lib/session-signature";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = "measureman_session";
const DEFAULT_SESSION_DAYS = 14;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${digest.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actualBuffer = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionDays() {
  const parsed = Number(process.env.AUTH_SESSION_TTL_DAYS ?? DEFAULT_SESSION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : DEFAULT_SESSION_DAYS;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays() * 24 * 60 * 60 * 1000);
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } }).catch(() => undefined);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, signSessionToken(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.AUTH_SECURE_COOKIE !== "false",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const rawCookie = store.get(SESSION_COOKIE)?.value;
  const token = verifySignedSessionCookie(rawCookie) ?? rawCookie;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const rawCookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const token = verifySignedSessionCookie(rawCookie);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role };
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireApiAuth(options?: { role?: "ADMIN" | "MEMBER" }): Promise<{ user: AuthUser } | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: Response.json({ error: "请先登录。" }, { status: 401 }) };
  }
  if (options?.role === "ADMIN" && user.role !== "ADMIN") {
    return { response: Response.json({ error: "需要管理员权限。" }, { status: 403 }) };
  }
  return { user };
}

export async function requirePageUser(nextPath?: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    const suffix = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/login${suffix}`);
  }
  return user;
}

export async function workspaceForUser(userId: string) {
  const membership = await prisma.workspaceMember.findFirst({ where: { userId }, include: { workspace: true } });
  if (membership) return membership.workspace;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("用户不存在。");
  return prisma.workspace.create({
    data: {
      name: "Measureman 运营协作空间",
      members: { create: { userId, role: user.role === "ADMIN" ? "OWNER" : "MEMBER" } },
    },
  });
}

export async function isBootstrapRequired() {
  return (await prisma.user.count()) === 0;
}
