import { NextResponse } from "next/server";
import { getAdminStorage } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lecture des images REJETÉES par le contrôle qualité (« qc-forensic »).
 *
 * L'orchestrateur sauvegarde chaque candidat refusé sous
 *   universes/{u}/books/{b}/generations/{g}/forensic/{characterId}_wf{N}_i{M}_{id}.png
 * mais les règles Storage interdisent toute lecture côté client, et ces images
 * ne sont exposées nulle part. Résultat : quand une génération échoue avec
 * « More than one character present », la preuve existe et personne ne la voit.
 *
 * On perd alors des heures à raisonner sur des prompts au lieu de regarder ce
 * que le modèle a réellement dessiné. Cette route rend ces images visibles.
 *
 * Accès : réservé aux emails listés dans ADMIN_EMAILS. Les URLs signées
 * expirent au bout d'une heure.
 *
 *   GET /api/admin/forensic?generationId=...            → toute la génération
 *   GET /api/admin/forensic?generationId=...&all=1      → tous les fichiers, pas
 *                                                          seulement les rejets
 */
export async function GET(request: Request) {
  const { user } = await requireUser();

  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = (user.email || "").toLowerCase();
  if (!admins.length || !email || !admins.includes(email)) {
    return NextResponse.json({ ok: false, raison: "INTERDIT" }, { status: 403 });
  }

  const url = new URL(request.url);
  const generationId = (url.searchParams.get("generationId") || "").trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(generationId)) {
    return NextResponse.json(
      { ok: false, raison: "generationId manquant ou invalide" },
      { status: 400 }
    );
  }
  const tout = url.searchParams.get("all") === "1";

  const bucket = getAdminStorage().bucket();

  // Le chemin complet contient l'univers et le livre, qu'on n'a pas forcément
  // sous la main : on liste donc par génération et on filtre. Le préfixe reste
  // ancré sur "universes/" pour ne jamais balayer tout le bucket.
  const [files] = await bucket.getFiles({ prefix: "universes/", maxResults: 4000 });

  const marqueur = `/generations/${generationId}/`;
  const retenus = files
    .filter((f) => f.name.includes(marqueur))
    .filter((f) => (tout ? true : f.name.includes("/forensic/")));

  const images = await Promise.all(
    retenus.map(async (f) => {
      const [signee] = await f.getSignedUrl({
        action: "read",
        expires: Date.now() + 60 * 60 * 1000,
      });
      const nom = f.name.split("/").pop() || f.name;
      // char_1_wf2_i1_a3.png → personnage char_1, tentative workflow 2, interne 1
      const m = nom.match(/^(.+?)_wf(\d+)_i(\d+)_(.+)\.png$/);
      return {
        fichier: nom,
        personnage: m?.[1] ?? null,
        tentativeWorkflow: m ? Number(m[2]) : null,
        tentativeInterne: m ? Number(m[3]) : null,
        chemin: f.name,
        url: signee,
      };
    })
  );

  images.sort((a, b) =>
    (a.personnage ?? "").localeCompare(b.personnage ?? "") ||
    (a.tentativeWorkflow ?? 0) - (b.tentativeWorkflow ?? 0) ||
    (a.tentativeInterne ?? 0) - (b.tentativeInterne ?? 0)
  );

  return NextResponse.json({
    ok: true,
    generationId,
    nombre: images.length,
    images,
  });
}
