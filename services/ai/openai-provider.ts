import OpenAI from "openai";
import {
  enforceParentChildHero,
  ensureMandatoryFamilyCast,
  lockPlanToParentNarrative,
  normalizeStoryPlan,
} from "@/services/ai/character-bible";
import {
  buildEnrichIdeaSystemPrompt,
  buildEnrichIdeaUserPrompt,
  buildExpandPagesSystemPrompt,
  buildResearchSystemPrompt,
  buildResearchUserPrompt,
  buildSettingBibleSystemPrompt,
  buildSettingBibleUserPrompt,
  buildStoryOutlineSystemPrompt,
  buildStorySystemPrompt,
  buildStoryUserPrompt,
} from "@/services/ai/prompts";
import { gatherWebResearch } from "@/services/ai/research";
import type {
  EnrichIdeaOptions,
  EnrichedIdea,
  ResearchBrief,
  SettingBible,
  StoryPlan,
  TextAIProvider,
} from "@/services/ai/types";
import {
  assertHeroGender,
  assertHeroIsChild,
  assertParentNarrativeLock,
  assertPlanFidelity,
  assertPoseDiversity,
  inferNarrativeThemeKey,
} from "@/lib/plan-fidelity";
import { AppError } from "@/lib/errors";

/**
 * Groq keeps a short timeout: its inference is fast, and failing over quickly
 * is the point. OpenAI is the failover of last resort — a full JSON story plan
 * routinely needs more than 30s there, so it gets a wide envelope (prod gen
 * 3296e412: every Groq 429/400 failover died on "Request timed out." at 30s,
 * killing the whole paid run). Steps are durable, the function budget absorbs it.
 */
const GROQ_TIMEOUT_MS = 30_000;
const OPENAI_TIMEOUT_MS = 120_000;

function createTextClient(prefer: "groq" | "openai" = "groq"): OpenAI {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (prefer === "openai" && openaiKey) {
    return new OpenAI({ apiKey: openaiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });
  }
  if (prefer === "groq" && groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: GROQ_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (openaiKey) {
    return new OpenAI({ apiKey: openaiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });
  }
  if (groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: GROQ_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 0,
  });
}

function resolveTextModel(prefer: "groq" | "openai" = "groq"): string {
  const usingGroq =
    prefer === "groq"
      ? Boolean(process.env.GROQ_API_KEY?.trim())
      : !process.env.OPENAI_API_KEY?.trim() && Boolean(process.env.GROQ_API_KEY?.trim());
  if (prefer === "openai" && process.env.OPENAI_API_KEY?.trim()) {
    return process.env.OPENAI_MODEL || "gpt-4o-mini";
  }
  if (usingGroq) {
    return process.env.GROQ_MODEL || process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function hasOpenAIFailover(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim());
}

/** Run a chat completion; on Groq JSON/400 failures, retry once on OpenAI. */
async function chatJsonCompletion(
  primary: OpenAI,
  primaryModel: string,
  params: Omit<Parameters<OpenAI["chat"]["completions"]["create"]>[0], "model"> & {
    model?: string;
  }
): Promise<string> {
  try {
    const response = await primary.chat.completions.create({
      ...params,
      model: params.model || primaryModel,
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
    // Non-streaming create returns ChatCompletion
    const content =
      "choices" in response ? response.choices[0]?.message?.content : null;
    if (!content) throw new Error("Empty text provider response");
    return content;
  } catch (err) {
    if (!hasOpenAIFailover()) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[text] primary failed (${msg.slice(0, 120)}); failover → OpenAI`);
    const fallback = createTextClient("openai");
    const response = await fallback.chat.completions.create({
      ...params,
      model: resolveTextModel("openai"),
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
    const content =
      "choices" in response ? response.choices[0]?.message?.content : null;
    if (!content) throw new Error("Empty text provider response (OpenAI failover)");
    return content;
  }
}

function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    // Some models wrap JSON in fences despite instructions
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Invalid JSON from ${label}`);
  }
}

function emptyResearchFallback(idea: string): ResearchBrief {
  const africanHint =
    /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne/i.test(
      idea
    );
  return {
    topic: idea.slice(0, 120),
    subjectType: "invented",
    facts: [],
    childSafeAngle: "Aventure douce et courageuse pour enfants, fidèle à l'idée.",
    culturalNotes: africanHint
      ? ["L'idée suggère un ancrage africain / ouest-africain — enrichir respectueusement."]
      : ["Suivre l'idée telle quelle ; monde global ou inventé selon le sujet."],
    westAfricanHooks: africanHint
      ? [
          "Scène de marché",
          "Baobab ou savane",
          "Foot de rue ou tam-tam",
          "Petit héros malin (personnage original, esprit conte)",
        ]
      : [],
    coloringBookScenes: [
      "Rencontre",
      "Chemin / découverte",
      "Aide d'un ami",
      "Célébration",
    ],
    characterVisualHints: [
      "Traits distinctifs stables (coiffure, accessoire, vêtement signature)",
    ],
    accuracyNotes: "Idée inventée ou sans faits web — liberté créative child-safe.",
    sourcesNote: "Connaissances générales / fallback local",
  };
}

function fallbackEnrichedIdea(rawIdea: string): EnrichedIdea {
  const trimmed = rawIdea.trim();
  const title =
    trimmed.length > 48 ? `${trimmed.slice(0, 45).trim()}…` : trimmed || "Mon livre de coloriage";
  const synopsis = trimmed
    ? `Une aventure douce et courageuse inspirée de votre idée : ${trimmed}`
    : "Une aventure douce et courageuse pour enfants.";
  const beats = [
    "Le héros découvre un monde à explorer",
    "Un défi apparaît sur le chemin",
    "Un ami apporte son aide",
    "La résolution joyeuse et rassurante",
  ];
  const castHints = ["Le héros principal", "Un ami bienveillant"];
  const creativeBrief = [
    `Titre : ${title}`,
    `Synopsis : ${synopsis}`,
    `Personnages : ${castHints.join(" · ")}`,
    `Trame : ${beats.join(" → ")}`,
    `Idée originale : ${trimmed}`,
  ].join("\n");
  return { title, synopsis, castHints, beats, creativeBrief };
}

function normalizeEnrichedIdea(raw: Partial<EnrichedIdea>, fallbackIdea: string): EnrichedIdea {
  const base = fallbackEnrichedIdea(fallbackIdea);
  const title = (raw.title || base.title).trim().slice(0, 120);
  const synopsis = (raw.synopsis || base.synopsis).trim().slice(0, 2000);
  const castHints = (Array.isArray(raw.castHints) ? raw.castHints : base.castHints)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 6);
  const beats = (Array.isArray(raw.beats) ? raw.beats : base.beats)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 6);
  let creativeBrief = (raw.creativeBrief || "").trim();
  if (!creativeBrief) {
    creativeBrief = [
      `Titre : ${title}`,
      `Synopsis : ${synopsis}`,
      castHints.length ? `Personnages : ${castHints.join(" · ")}` : "",
      beats.length ? `Trame : ${beats.join(" → ")}` : "",
      `Idée originale : ${fallbackIdea.trim()}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return {
    title,
    synopsis,
    castHints: castHints.length ? castHints : base.castHints,
    beats: beats.length ? beats : base.beats,
    creativeBrief: creativeBrief.slice(0, 4000),
  };
}

export class OpenAITextProvider implements TextAIProvider {
  private client: OpenAI;

  constructor() {
    this.client = createTextClient();
  }

  /** Chat completion with Groq→OpenAI failover on provider errors. */
  private async completeJson(
    params: Omit<Parameters<OpenAI["chat"]["completions"]["create"]>[0], "model">
  ): Promise<string> {
    return chatJsonCompletion(this.client, resolveTextModel(), params);
  }

  async enrichIdea(rawIdea: string, opts?: EnrichIdeaOptions): Promise<EnrichedIdea> {
    const idea = rawIdea.trim();
    if (idea.length < 3) return fallbackEnrichedIdea(idea);

    try {
      const content = await this.completeJson({
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildEnrichIdeaSystemPrompt(opts?.style) },
          { role: "user", content: buildEnrichIdeaUserPrompt(idea, opts) },
        ],
      });
      const parsed = parseJson<Partial<EnrichedIdea>>(content, "enrich idea");
      return normalizeEnrichedIdea(parsed, idea);
    } catch {
      return fallbackEnrichedIdea(idea);
    }
  }

  async buildResearchBrief(idea: string): Promise<ResearchBrief> {
    const web = await gatherWebResearch(idea);
    let content: string;
    try {
      content = await this.completeJson({
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildResearchSystemPrompt() },
          {
            role: "user",
            content: buildResearchUserPrompt(idea, web.context),
          },
        ],
      });
    } catch {
      const fallback = emptyResearchFallback(idea);
      fallback.sourcesNote = `Web: ${web.source}; LLM fail — fallback`;
      return fallback;
    }

    const brief = parseJson<ResearchBrief>(content, "research brief");
    brief.sourcesNote = [
      brief.sourcesNote,
      web.source !== "none" ? `Web: ${web.source}` : "Web: aucun extrait",
    ]
      .filter(Boolean)
      .join(" | ");
    return brief;
  }

  async generateStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    research?: ResearchBrief,
    audience?: string,
    opts?: {
      originalIdea?: string;
      childName?: string;
      childGender?: string;
      parentMode?: boolean;
    }
  ): Promise<StoryPlan> {
    const brief = research ?? (await this.buildResearchBrief(idea));
    const originalIdea = opts?.originalIdea || idea;

    const parentNormOpts = opts?.parentMode
      ? {
          parentMode: true as const,
          narrativeLock: originalIdea,
          themeKey: inferNarrativeThemeKey(originalIdea),
          childGender: opts.childGender,
        }
      : undefined;

    const finalize = (raw: StoryPlan): StoryPlan => {
      let plan = normalizeStoryPlan(raw, pageCount, parentNormOpts);
      if (opts?.parentMode && opts.childName) {
        plan = enforceParentChildHero(plan, {
          childName: opts.childName,
          childGender: opts.childGender,
          audience,
        });
        plan = normalizeStoryPlan(plan, pageCount, parentNormOpts);
      }
      if (opts?.parentMode) {
        // The story's mandatory family cast (parents / pet) must exist as
        // named characters no matter which provider planned — the viability
        // gate downstream is a check, not a place to die on a model's omission.
        plan = ensureMandatoryFamilyCast(plan, originalIdea);
        plan = normalizeStoryPlan(plan, pageCount, parentNormOpts);
      }
      return plan;
    };

    const buildOnce = async (): Promise<StoryPlan> => {
      if (pageCount > 8) {
        return finalize(
          await this.generateLongStoryPlan(idea, pageCount, style, brief, audience, opts)
        );
      }

      const planRequest = {
        temperature: opts?.parentMode ? 0.55 : 0.75,
        response_format: { type: "json_object" as const },
        messages: [
          {
            role: "system" as const,
            content: buildStorySystemPrompt(pageCount, style, audience),
          },
          {
            role: "user" as const,
            content: buildStoryUserPrompt({
              idea,
              pageCount,
              style,
              researchJson: JSON.stringify(brief, null, 2),
              audience,
              originalIdea,
              childName: opts?.childName,
              childGender: opts?.childGender,
              parentMode: opts?.parentMode,
            }),
          },
        ],
      };
      const parsePlan = (content: string): StoryPlan => {
        const plan = parseJson<StoryPlan>(content, "story plan");
        if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
          throw new Error("Story plan missing pages");
        }
        return plan;
      };

      try {
        return finalize(parsePlan(await this.completeJson(planRequest)));
      } catch (err) {
        // Groq can return well-formed HTTP with a semantically empty plan
        // (prod gen 3296e412 attempt 3: "Story plan missing pages") —
        // chatJsonCompletion's failover never sees it. Retry once on OpenAI.
        if (!hasOpenAIFailover()) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[text] story plan invalid from primary (${msg.slice(0, 120)}); semantic failover → OpenAI`
        );
        return finalize(
          parsePlan(
            await chatJsonCompletion(
              createTextClient("openai"),
              resolveTextModel("openai"),
              planRequest
            )
          )
        );
      }
    };

    let plan = await buildOnce();
    let fidelity = assertPlanFidelity(originalIdea, plan);
    let narrative = opts?.parentMode
      ? assertParentNarrativeLock(originalIdea, plan)
      : ({ ok: true } as const);
    let diversity = assertPoseDiversity(plan);
    let childOk = opts?.parentMode
      ? assertHeroIsChild(plan, opts.childName)
      : ({ ok: true } as const);
    let genderOk = opts?.parentMode
      ? assertHeroGender(plan, opts.childGender, opts.childName)
      : ({ ok: true } as const);

    if (!fidelity.ok || !narrative.ok || !diversity.ok || !childOk.ok || !genderOk.ok) {
      console.warn("story plan fidelity/narrative/diversity/child failed; retrying once", {
        fidelity,
        narrative,
        diversity,
        childOk,
        genderOk,
      });
      plan = await buildOnce();
      fidelity = assertPlanFidelity(originalIdea, plan);
      narrative = opts?.parentMode
        ? assertParentNarrativeLock(originalIdea, plan)
        : ({ ok: true } as const);
      diversity = assertPoseDiversity(plan);
      childOk = opts?.parentMode
        ? assertHeroIsChild(plan, opts.childName)
        : ({ ok: true } as const);
      genderOk = opts?.parentMode
        ? assertHeroGender(plan, opts.childGender, opts.childName)
        : ({ ok: true } as const);

      // Parent books: rewrite drifted plots instead of shipping a wrong adventure.
      if (
        opts?.parentMode &&
        opts.childName &&
        (!fidelity.ok || !narrative.ok || !childOk.ok || !genderOk.ok)
      ) {
        console.warn("parent plan still drifted after retry; locking to parent narrative", {
          fidelity,
          narrative,
          childOk,
          genderOk,
        });
        plan = lockPlanToParentNarrative(plan, {
          sourceNarrative: originalIdea,
          childName: opts.childName,
          childGender: opts.childGender,
          audience,
          pageCount,
        });
        fidelity = assertPlanFidelity(originalIdea, plan);
        narrative = assertParentNarrativeLock(originalIdea, plan);
        childOk = assertHeroIsChild(plan, opts.childName);
        genderOk = assertHeroGender(plan, opts.childGender, opts.childName);
      }

      if (!opts?.parentMode && !fidelity.ok) {
        throw new AppError(
          "GENERATION_FAILED",
          `Plan hors sujet par rapport à l'idée : ${(fidelity.reasons || []).join(" ")}`,
          422
        );
      }
      if (opts?.parentMode && (!fidelity.ok || !narrative.ok)) {
        // Already rewrote — if still failing, ship the locked rewrite (better than wrong plot).
        console.warn("parent narrative lock soft-accepting rewritten plan", {
          fidelity,
          narrative,
        });
      }
      if (!childOk.ok || !genderOk.ok) {
        if (opts?.childName) {
          plan = enforceParentChildHero(plan, {
            childName: opts.childName,
            childGender: opts.childGender,
            audience,
          });
          plan = normalizeStoryPlan(plan, pageCount, parentNormOpts);
        }
      }
      if (!diversity.ok) {
        console.warn("pose diversity still weak after retry; continuing", diversity);
      }
    }
    return plan;
  }

  /** Two-phase plan for long books (couvre les livres jusqu'à 25-40 pages). */
  private async generateLongStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    brief: ResearchBrief,
    audience?: string,
    opts?: {
      originalIdea?: string;
      childName?: string;
      childGender?: string;
      parentMode?: boolean;
    }
  ): Promise<StoryPlan> {
    // Phase 1 — master outline. The free-tier output cut (~3k tokens) also
    // limits the OUTLINE, so pages are outlined in slices of 12: first call
    // returns the frame + pages 1..12, follow-up calls continue the arc.
    const OUTLINE_SLICE = 12;
    const firstEnd = Math.min(OUTLINE_SLICE, pageCount);
    const outlineContent = await this.completeJson({
      temperature: 0.75,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildStoryOutlineSystemPrompt(pageCount, style, audience) },
        {
          role: "user",
          content: `${buildStoryUserPrompt({
            idea,
            pageCount,
            style,
            researchJson: JSON.stringify(brief, null, 2),
            audience,
            originalIdea: opts?.originalIdea || idea,
            childName: opts?.childName,
            childGender: opts?.childGender,
            parentMode: opts?.parentMode,
          })}\n\nTRANCHE DEMANDÉE : cadre complet (title/concept/characters/world) + pages ${1} à ${firstEnd} UNIQUEMENT (le livre continuera jusqu'à la page ${pageCount} ensuite${pageCount > firstEnd ? " — ne conclus PAS l'histoire dans cette tranche" : ""}).`,
        },
      ],
    });
    const outline = parseJson<StoryPlan>(outlineContent, "story outline");
    if (!Array.isArray(outline.pages) || outline.pages.length === 0) {
      throw new Error("Story outline missing pages");
    }
    outline.pages = outline.pages.slice(0, firstEnd);

    // Continue the outline in slices until every page has a synopsis.
    while (outline.pages.length < pageCount) {
      const from = outline.pages.length + 1;
      const to = Math.min(from + OUTLINE_SLICE - 1, pageCount);
      const tail = outline.pages.slice(-3).map((p) => ({
        pageNumber: p.pageNumber,
        title: p.title,
        storyText: p.storyText,
        action: p.action,
      }));
      const contContent = await this.completeJson({
        temperature: 0.75,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildStoryOutlineSystemPrompt(pageCount, style, audience) },
          {
            role: "user",
            content: `SUITE DU PLAN DIRECTEUR — cadre déjà fixé (NE le répète pas, produis UNIQUEMENT {"pages":[...]}) :\nCADRE : ${JSON.stringify({ title: outline.title, summary: outline.summary, characters: (outline.characters || []).map((c) => ({ id: c.id, name: c.name, introducedOnPage: c.introducedOnPage })), world: outline.world }, null, 1)}\nDERNIÈRES PAGES ÉCRITES : ${JSON.stringify(tail, null, 1)}\n\nTRANCHE DEMANDÉE : pages ${from} à ${to} en continuité directe${to >= pageCount ? " — l'histoire DOIT se conclure (resolution) à la page " + pageCount : " — ne conclus pas encore"}.`,
          },
        ],
      });
      const cont = parseJson<{ pages?: StoryPlan["pages"] }>(contContent, "outline continuation");
      const contPages = (Array.isArray(cont.pages) ? cont.pages : []).slice(0, to - from + 1);
      if (!contPages.length) throw new Error("Outline continuation missing pages");
      contPages.forEach((p, j) => (p.pageNumber = from + j));
      outline.pages.push(...contPages);
    }

    // Phase 2 — expand pages in small batches (each fits under the output cut).
    const BATCH = 6;
    const frame = {
      title: outline.title,
      summary: outline.summary,
      characters: (outline.characters || []).map((c) => ({
        id: c.id,
        name: c.name,
        visualLock: c.visualLock,
        introducedOnPage: c.introducedOnPage,
      })),
      world: outline.world,
    };
    const expandedPages: StoryPlan["pages"] = [];
    for (let i = 0; i < outline.pages.length; i += BATCH) {
      const batch = outline.pages.slice(i, i + BATCH);
      try {
        const content = await this.completeJson({
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildExpandPagesSystemPrompt(style) },
            {
              role: "user",
              content: `CADRE DU LIVRE :\n${JSON.stringify(frame, null, 1)}\n\nLOT DE PAGES À DÉVELOPPER (recopie pageNumber/title/storyText/action/characterIds/comicBeat/shotType à l'identique) :\n${JSON.stringify(batch, null, 1)}`,
            },
          ],
        });
        const parsed = parseJson<{ pages?: StoryPlan["pages"] }>(content, "page expansion");
        const got = Array.isArray(parsed?.pages) ? parsed.pages : [];
        // Match by pageNumber; any page the expansion lost falls back to its outline
        // (normalizeStoryPlan still produces a usable prompt from action/storyText).
        for (const o of batch) {
          const hit = got.find((p) => p.pageNumber === o.pageNumber);
          expandedPages.push(hit ? { ...o, ...hit } : o);
        }
      } catch (err) {
        console.warn(
          `page expansion batch ${i / BATCH + 1} failed; using outline pages`,
          err
        );
        expandedPages.push(...batch);
      }
    }

    // Long books already normalize inside generateLongStoryPlan caller via finalize —
    // return raw outline expansion for finalize() to process.
    return normalizeStoryPlan({ ...outline, pages: expandedPages }, pageCount);
  }

  async generateSettingBible(params: {
    universeTitle: string;
    universeDescription?: string;
    worldSetting?: string;
    style?: string;
  }): Promise<SettingBible> {
    const content = await this.completeJson({
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSettingBibleSystemPrompt() },
        { role: "user", content: buildSettingBibleUserPrompt(params) },
      ],
    });
    const raw = parseJson<Partial<SettingBible>>(content, "setting bible");
    const elements = (Array.isArray(raw.elements) ? raw.elements : [])
      .map((e) => String(e).trim())
      .filter(Boolean)
      .slice(0, 12);
    if (elements.length < 4) throw new Error("Setting bible too sparse");
    return {
      worldSummary: String(raw.worldSummary || params.worldSetting || params.universeTitle).trim(),
      elements,
      forbiddenElements: (Array.isArray(raw.forbiddenElements) ? raw.forbiddenElements : [])
        .map((e) => String(e).trim())
        .filter(Boolean)
        .slice(0, 8),
    };
  }
}

// ── Exports du cœur texte (bascule Groq→OpenAI réutilisable) ────────────────
export function hasTextProviderKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export type ChatParams = Omit<
  Parameters<OpenAI["chat"]["completions"]["create"]>[0],
  "model"
> & { model?: string };

/** Complétion JSON avec le client par défaut (Groq d'abord, OpenAI en secours). */
export async function completeJson(params: ChatParams): Promise<string> {
  return chatJsonCompletion(createTextClient(), resolveTextModel(), params);
}
