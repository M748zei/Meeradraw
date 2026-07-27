import {
  getRedirectResult,
  type Auth,
  type UserCredential,
} from "firebase/auth";

const IOS_DEVICE_PATTERN = /iPad|iPhone|iPod/i;

export const GOOGLE_REDIRECT_NEXT_KEY = "meeradraw:google-auth-next";

let redirectResultPromise: Promise<UserCredential | null> | null = null;

export function isIosOrIpadOs(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): boolean {
  return (
    IOS_DEVICE_PATTERN.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export function shouldUseGoogleRedirect(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosOrIpadOs(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints
  );
}

/**
 * React development mode can mount an effect twice. Firebase redirect results
 * are consumable only once, so every mount must share the same promise.
 */
export function consumeGoogleRedirectResult(
  auth: Auth
): Promise<UserCredential | null> {
  redirectResultPromise ??= getRedirectResult(auth);
  return redirectResultPromise;
}
