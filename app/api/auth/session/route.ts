import { apiError, apiSuccess, AppError } from "@/lib/errors";
import {
  createSessionCookie,
  getSessionUser,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/firebase/session";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { buildNewProfile } from "@/lib/api-auth";
import { isDisposableEmail } from "@/lib/disposable-email";
import { clientIp, rateLimit } from "@/lib/rate-limit-store";
import { z } from "zod";

const schema = z.object({ idToken: z.string().min(10) });

function expireSessionCookie<T extends Response>(response: T): T {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${SESSION_COOKIE_OPTIONS.secure ? "; Secure" : ""}`
  );
  return response;
}

export async function POST(request: Request) {
  try {
    rateLimit(`session:${clientIp(request)}`, { limit: 15, windowMs: 60_000 });
    const { idToken } = schema.parse(await request.json());
    const decoded = await getAdminAuth().verifyIdToken(idToken);

    // Un compte = une vraie adresse. Les domaines jetables sont rejetés et
    // l'utilisateur Auth tout juste créé est supprimé (pas de compte zombie).
    if (isDisposableEmail(decoded.email)) {
      await getAdminAuth()
        .deleteUser(decoded.uid)
        .catch(() => undefined);
      throw new AppError("VALIDATION_ERROR", "Utilise une adresse email valide.", 403);
    }

    if (isFirebaseAdminConfigured()) {
      const db = getAdminDb();
      const ref = db.collection("users").doc(decoded.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set(buildNewProfile(decoded));
      }
    }

    // Attach the cookie to this exact HTTP response. This avoids reporting a
    // successful login when the cookie mutation is not serialized by the
    // runtime/proxy that serves the route.
    const sessionCookie = await createSessionCookie(idToken);
    const response = Response.json({
      success: true,
      data: { uid: decoded.uid },
    });
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sessionCookie}; Max-Age=${SESSION_COOKIE_OPTIONS.maxAge}; Path=/; HttpOnly; SameSite=Lax${SESSION_COOKIE_OPTIONS.secure ? "; Secure" : ""}`
    );
    return response;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return apiError(new AppError("VALIDATION_ERROR", "Token invalide", 400));
    }
    return apiError(e);
  }
}

export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) {
      return expireSessionCookie(
        apiError(new AppError("UNAUTHORIZED", "Session non conservée", 401))
      );
    }
    return apiSuccess({ uid: session.uid });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    return expireSessionCookie(apiSuccess({ signedOut: true }));
  } catch (e) {
    return apiError(e);
  }
}
