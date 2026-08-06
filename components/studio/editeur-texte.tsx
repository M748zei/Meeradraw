"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Le texte est incrusté au canvas, jamais généré (§5 du brief) : les modèles
 * écrivent mal le français, un accent raté tue l'image. Blanc, gras, condensé,
 * centré, tiers inférieur, ombre portée + ligne de date plus petite.
 * Déplaçable au doigt, taille réglable. Le téléchargement fusionne le texte.
 */

const POLICE_CONDENSEE =
  "'Archivo Narrow','Roboto Condensed','Arial Narrow',Impact,'Helvetica Neue',sans-serif";

function dessiner(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  opts: { texte: string; date: string; taille: number; y: number }
) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(image, 0, 0, W, H);
  const taillePx = Math.round((opts.taille / 100) * W * 0.09 + W * 0.03);
  const centreY = Math.round((opts.y / 100) * H);
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = Math.round(taillePx * 0.35);
  ctx.shadowOffsetY = Math.round(taillePx * 0.08);
  ctx.fillStyle = "#ffffff";

  if (opts.texte.trim()) {
    ctx.font = `700 ${taillePx}px ${POLICE_CONDENSEE}`;
    // Retour à la ligne manuel : on respecte les \n de l'utilisateur,
    // et on coupe automatiquement ce qui déborde du cadre.
    const lignes: string[] = [];
    for (const brute of opts.texte.split("\n")) {
      let courante = "";
      for (const mot of brute.split(/\s+/).filter(Boolean)) {
        const essai = courante ? `${courante} ${mot}` : mot;
        if (ctx.measureText(essai).width > W * 0.92 && courante) {
          lignes.push(courante);
          courante = mot;
        } else {
          courante = essai;
        }
      }
      if (courante) lignes.push(courante);
    }
    const interligne = Math.round(taillePx * 1.12);
    const y0 = centreY - Math.round(((lignes.length - 1) * interligne) / 2);
    lignes.forEach((l, i) => ctx.fillText(l.toUpperCase(), W / 2, y0 + i * interligne));
    if (opts.date.trim()) {
      ctx.font = `600 ${Math.round(taillePx * 0.45)}px ${POLICE_CONDENSEE}`;
      ctx.fillText(
        opts.date.toUpperCase(),
        W / 2,
        y0 + lignes.length * interligne + Math.round(taillePx * 0.2)
      );
    }
  } else if (opts.date.trim()) {
    ctx.font = `600 ${Math.round(taillePx * 0.45)}px ${POLICE_CONDENSEE}`;
    ctx.fillText(opts.date.toUpperCase(), W / 2, centreY);
  }
  ctx.shadowColor = "transparent";
}

export function EditeurTexte({ url, onFermer }: { url: string; onFermer: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [texte, setTexte] = useState("");
  const [date, setDate] = useState("");
  const [taille, setTaille] = useState(50);
  const [y, setY] = useState(75); // tiers inférieur par défaut
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const glisse = useRef(false);

  const redessiner = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    dessiner(ctx, image, { texte, date, taille, y });
  }, [texte, date, taille, y]);

  useEffect(() => {
    const image = new Image();
    // Même origine via le proxy : le canvas reste exportable (jamais « tainted »).
    image.src = `/api/images/proxy?url=${encodeURIComponent(url)}`;
    image.onload = () => {
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
      }
      setPret(true);
    };
    image.onerror = () => setErreur("Impossible de charger l'image pour l'édition.");
  }, [url]);

  useEffect(() => {
    if (pret) redessiner();
  }, [pret, redessiner]);

  function surPointeur(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!glisse.current && e.type !== "pointerdown") return;
    if (e.type === "pointerdown") glisse.current = true;
    if (e.type === "pointerup" || e.type === "pointercancel") {
      glisse.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    setY(Math.min(95, Math.max(5, Math.round(ratio * 100))));
  }

  function telecharger() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErreur("L'export a échoué — réessaie.");
          return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `scarabee-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto">
        <canvas
          ref={canvasRef}
          onPointerDown={surPointeur}
          onPointerMove={surPointeur}
          onPointerUp={surPointeur}
          onPointerCancel={surPointeur}
          className="max-h-[55vh] w-full touch-none rounded-xl object-contain"
          style={{ objectFit: "contain" }}
        />
        <p className="text-center text-xs text-white/70">
          Glisse sur l&apos;image pour placer le texte.
        </p>
        <Input
          placeholder="Ton titre — exemple : LE CASSE DU SIÈCLE"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
        <Input
          placeholder="Ligne de date — exemple : Bouaké, 2003"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <label className="flex items-center gap-3 text-sm text-white">
          Taille
          <input
            type="range"
            min={0}
            max={100}
            value={taille}
            onChange={(e) => setTaille(Number(e.target.value))}
            className="flex-1"
          />
        </label>
        {erreur ? <p className="text-sm text-rose-300">{erreur}</p> : null}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={telecharger} disabled={!pret}>
            Télécharger l&apos;image
          </Button>
          <Button variant="secondary" onClick={onFermer}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
