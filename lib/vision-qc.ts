/**
 * Vision QC (audit fixes T4/T5/T6) — scene-level checks the pixel guards
 * (lib/image-quality.ts) cannot do: cast count/species, lineup syndrome,
 * action visibility, cover-title legibility.
 *
 * Provider: Groq multimodal (qwen3.6-27b — the only vision-capable model on
 * this account; Scout/Maverick are not offered). It is a "thinking" model, so
 * answers are parsed after stripping the <think> block.
 *
 * FAIL-OPEN BY DESIGN: any provider error, timeout, or unparsable answer
 * returns null ("cannot judge") and the caller MUST accept the image. Vision QC
 * is a safety net — it must never break or block a generation.
 */

const VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
const VISION_TIMEOUT_MS = Number(process.env.VISION_QC_TIMEOUT_MS || 25_000);

function visionEnabled(): boolean {
  if (process.env.VISION_QC === "false") return false;
  return Boolean(process.env.GROQ_API_KEY);
}

export interface CastCheck {
  /** Number of distinct characters the model sees in the image. */
  count: number;
  /** True when count and species/kinds match the expected cast. */
  matches: boolean;
  /** Short English reason when it does not match. */
  issue?: string;
}

export interface PageCheck {
  /** True = characters standing in a row, front-facing, no action (the audit's #1 defect). */
  lineup: boolean;
  /** True = the requested action is actually visible in the image. */
  actionVisible: boolean;
  issue?: string;
}

export interface CoverCheck {
  /** True = the title text is present and clearly legible. */
  titleLegible: boolean;
  issue?: string;
}

/**
 * Downscale the image to ~512px and inline it as a data URL. Full-size images
 * cost ~6-7k vision tokens each and blow Groq's 8000 TPM in minutes (verified:
 * a 2-book run rate-limited half the checks into fail-open). 512px keeps the
 * lineup/cast signals intact at ~4x fewer tokens.
 */
async function toSmallDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const small = await sharp(buf)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Ask one JSON question about an image. Returns null on ANY failure (fail-open). */
async function askVision<T>(imageUrl: string, question: string): Promise<T | null> {
  if (!visionEnabled()) return null;
  const inlined = (await toSmallDataUrl(imageUrl)) || imageUrl;

  // One retry on 429: Groq TPM windows are per-minute, a short backoff often
  // lands in the next window. More than one retry would stall the pipeline.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          temperature: 0,
          // Thinking model: without this the <think> block eats the token budget
          // before the JSON answer (verified on Groq qwen3.6-27b).
          reasoning_effort: "none",
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${question}\n\nAnswer with ONLY a single JSON object, no markdown, no extra prose after the JSON.`,
                },
                { type: "image_url", image_url: { url: inlined } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Math.min(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 12_000,
          20_000
        );
        console.warn(`[vision-qc] 429 rate limit; retry in ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        console.warn(`[vision-qc] provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content || "";
      // Thinking model: drop the <think> block, then take the first JSON object.
      const afterThink = raw.includes("</think>")
        ? raw.slice(raw.lastIndexOf("</think>") + "</think>".length)
        : raw;
      const match = afterThink.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return JSON.parse(match[0]) as T;
    } catch (err) {
      console.warn("[vision-qc] unavailable (fail-open)", err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * T4 — cast fidelity: does the image contain EXACTLY the expected characters
 * (count + species/kind)? Used on the model sheet, the cover and pages.
 */
export async function checkCast(
  imageUrl: string,
  expected: Array<{ name: string; kind: string }>
): Promise<CastCheck | null> {
  if (!expected.length) return null;
  const castDesc = expected.map((c) => `${c.name} (${c.kind})`).join(", ");
  const result = await askVision<{ count: number; matches: boolean; issue?: string }>(
    imageUrl,
    `This image should contain EXACTLY ${expected.length} character(s): ${castDesc} — and NOBODY else (no extra people, no extra animals).
For each expected character, verify its KIND is correct (a turtle must be drawn as a real turtle, not a human; an elephant as an elephant, etc.).
Any ANIMAL character must be a REAL animal in its natural stance — a quadruped stands/walks on ALL FOUR legs, is NOT upright on two legs like a person, wears NO clothes.
JSON schema: {"count": <number of distinct characters you see>, "matches": <true only if count is exactly ${expected.length} AND every character's kind is correct AND animals are in natural non-anthropomorphic stance>, "issue": "<short reason when matches is false>"}`
  );
  if (!result || typeof result.matches !== "boolean") return null;
  return {
    count: Number(result.count) || 0,
    matches: result.matches,
    issue: result.issue ? String(result.issue).slice(0, 200) : undefined,
  };
}

/**
 * T5 — anti-lineup: are the characters just standing in a row facing the camera
 * with no action, and is the page's requested action actually visible?
 */
export async function checkPageAction(
  imageUrl: string,
  action: string
): Promise<PageCheck | null> {
  const result = await askVision<{
    lineup: boolean;
    action_visible: boolean;
    issue?: string;
  }>(
    imageUrl,
    `This is a children's coloring book page. Requested action for this page: "${action}".
Question 1 (lineup syndrome): are the characters simply STANDING IN A ROW, front-facing, side by side, with static poses and no real action — like a character reference sheet where only the background changed?
Question 2: is the requested action ("${action}") actually VISIBLE in the drawing (the characters are physically doing it)?
JSON schema: {"lineup": <true if question 1 is yes>, "action_visible": <true if question 2 is yes>, "issue": "<short reason when lineup is true or action_visible is false>"}`
  );
  if (!result || typeof result.lineup !== "boolean") return null;
  return {
    lineup: result.lineup,
    actionVisible: Boolean(result.action_visible),
    issue: result.issue ? String(result.issue).slice(0, 200) : undefined,
  };
}

/** T6 — cover title: is the exact title present and clearly legible? */
export async function checkCoverTitle(
  imageUrl: string,
  title: string
): Promise<CoverCheck | null> {
  const result = await askVision<{ title_legible: boolean; issue?: string }>(
    imageUrl,
    `This is a children's coloring book COVER that should display the title text "${title}".
Is that exact title present, correctly spelled, and clearly legible?
JSON schema: {"title_legible": <boolean>, "issue": "<short reason when false>"}`
  );
  if (!result || typeof result.title_legible !== "boolean") return null;
  return {
    titleLegible: result.title_legible,
    issue: result.issue ? String(result.issue).slice(0, 200) : undefined,
  };
}
