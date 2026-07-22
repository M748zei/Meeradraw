import OpenAI from "openai";
import { normalizeStoryPlan } from "@/services/ai/character-bible";
import {
  buildEnrichIdeaSystemPrompt,
  buildEnrichIdeaUserPrompt,
  buildResearchSystemPrompt,
  buildResearchUserPrompt,
  buildSettingBibleSystemPrompt,
  buildSettingBibleUserPrompt,
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

function createTextClient(): OpenAI {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function resolveTextModel(): string {
  if (process.env.GROQ_API_KEY) {
    return process.env.GROQ_MODEL || process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
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

  async enrichIdea(rawIdea: string): Promise<EnrichedIdea> {
    const idea = rawIdea.trim();
    if (idea.length < 3) return fallbackEnrichedIdea(idea);

    try {
      const response = await this.client.chat.completions.create({
        model: resolveTextModel(),
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildEnrichIdeaSystemPrompt() },
          { role: "user", content: buildEnrichIdeaUserPrompt(idea) },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return fallbackEnrichedIdea(idea);
      const parsed = parseJson<Partial<EnrichedIdea>>(content, "enrich idea");
      return normalizeEnrichedIdea(parsed, idea);
    } catch {
      return fallbackEnrichedIdea(idea);
    }
  }

  async buildResearchBrief(idea: string): Promise<ResearchBrief> {
    const web = await gatherWebResearch(idea);
    const response = await this.client.chat.completions.create({
      model: resolveTextModel(),
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

    const content = response.choices[0]?.message?.content;
    if (!content) {
      const fallback = emptyResearchFallback(idea);
      fallback.sourcesNote = `Web: ${web.source}; LLM vide — fallback`;
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

    const response = await this.client.chat.completions.create({
      model: resolveTextModel(),
      temperature: 0.75,
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

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty text provider response");
    }

    const plan = parseJson<StoryPlan>(content, "story plan");
    if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
      throw new Error("Story plan missing pages");
    }
    return normalizeStoryPlan(plan, pageCount);
  }

  async generateSettingBible(params: {
    universeTitle: string;
    universeDescription?: string;
    worldSetting?: string;
    style?: string;
  }): Promise<SettingBible> {
    const response = await this.client.chat.completions.create({
      model: resolveTextModel(),
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSettingBibleSystemPrompt() },
        { role: "user", content: buildSettingBibleUserPrompt(params) },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty setting bible response");
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
