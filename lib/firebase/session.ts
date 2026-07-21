import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE = "__session";
const EXPIRES_IN_MS = 60 * 60 * 24 * 5 * 1000; // 5 days

export async function createSessionCookie(idToken: string) {
  const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
    expiresIn: EXPIRES_IN_MS,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: EXPIRES_IN_MS / 1000,
    path: "/",
    sameSite: "lax",
  });
  return sessionCookie;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded;
  } catch {
    return null;
  }
}
