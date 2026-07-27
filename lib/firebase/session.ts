import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { cache } from "react";

export const SESSION_COOKIE = "__session";
const EXPIRES_IN_MS = 60 * 60 * 24 * 5 * 1000; // 5 days
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: EXPIRES_IN_MS / 1000,
  path: "/",
  sameSite: "lax" as const,
};

export async function createSessionCookie(idToken: string) {
  return getAdminAuth().createSessionCookie(idToken, {
    expiresIn: EXPIRES_IN_MS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}

export const getSessionUser = cache(async () => {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded;
  } catch {
    return null;
  }
});
