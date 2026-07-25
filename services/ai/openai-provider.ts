import OpenAI from "openai";
import { normalizeStoryPlan } from "@/services/ai/character-bible";
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
  EnrichedIdea,
  ResearchBrief,
  SettingBible,
  StoryPlan,
  TextAIProvider,
} from "@/services/ai/types";

function createTextClient(prefer: "groq" | "openai" = "groq"): OpenAI {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (prefer === "openai" && openaiKey) {
    return new OpenAI({ apiKey: openaiKey });
  }
  if (prefer === "groq" && groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  if (openaiKey) {
    return new OpenAI({ apiKey: openaiKey });
  }
  if (groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

  async enrichIdea(rawIdea: string): Promise<EnrichedIdea> {
    const idea = rawIdea.trim();
    if (idea.length < 3) return fallbackEnrichedIdea(idea);

    try {
      const content = await this.completeJson({
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildEnrichIdeaSystemPrompt() },
          { role: "user", content: buildEnrichIdeaUserPrompt(idea) },
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
    audience?: string
  ): Promise<StoryPlan> {
    const brief = research ?? (await this.buildResearchBrief(idea));

    // Long books: the Groq free tier cuts completions around ~3k tokens
    // (finish_reason=length), so a full structured storyboard beyond ~8 pages
    // truncates into invalid JSON. Two-phase generation keeps every call small:
    // master outline first, then page expansion in batches.
    if (pageCount > 8) {
      return this.generateLongStoryPlan(idea, pageCount, style, brief, audience);
    }

    const content = await this.completeJson({
      temperature: 0.75,
      // NOTE: do NOT set max_completion_tokens here — Groq's free-tier TPM
      // pre-check counts it against the 8000-token/min budget and rejects the
      // whole request ("Request too large"). Left unset, only prompt tokens
      // are pre-checked and long storyboards (24 pages) stream fine.
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildStorySystemPrompt(pageCount, style, audience),
        },
        {
          role: "user",
          content: buildStoryUserPrompt({
            idea,
            pageCount,
            style,
            researchJson: JSON.stringify(brief, null, 2),
            audience,
          }),
        },
      ],
    });

    const plan = parseJson<StoryPlan>(content, "story plan");
    if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
      throw new Error("Story plan missing pages");
    }
    return normalizeStoryPlan(plan, pageCount);
  }

  /** Two-phase plan for long books (couvre les livres jusqu'à 25-40 pages). */
  private async generateLongStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    brief: ResearchBrief,
    audience?: string
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
