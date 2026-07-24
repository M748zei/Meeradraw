import { requireUser } from "@/lib/api-auth";
import { apiError, apiSuccess } from "@/lib/errors";
import { toPublicProfile } from "@/lib/public-profile";
import { z } from "zod";

export async function GET() {
  try {
    const { profile, user } = await requireUser();
    return apiSuccess(
      toPublicProfile(
        {
          ...(profile ?? {}),
          email: user.email ?? profile?.email ?? "",
        },
        user.id
      )
    );
  } catch (e) {
    return apiError(e);
  }
}

const updateSchema = z.object({
  fullname: z.string().min(1).max(120).optional(),
  preferred_language: z.string().min(2).max(5).optional(),
  avatar_url: z.string().url().optional(),
});

export async function PATCH(request: Request) {
  try {
    const { db, user } = await requireUser();
    const body = updateSchema.parse(await request.json());
    await db.collection("users").doc(user.id).update({
      ...body,
      updated_at: new Date().toISOString(),
    });
    const snap = await db.collection("users").doc(user.id).get();
    return apiSuccess(toPublicProfile(snap.data(), snap.id));
  } catch (e) {
    return apiError(e);
  }
}
