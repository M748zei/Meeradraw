import { normalizeStoryPlan } from "@/services/ai/character-bible";
import type {
  EnrichedIdea,
  ImageAIProvider,
  ImageGenerationInput,
  ResearchBrief,
  StoryPlan,
  TextAIProvider,
} from "@/services/ai/types";

export class MockTextProvider implements TextAIProvider {
  async enrichIdea(rawIdea: string): Promise<EnrichedIdea> {
    const idea = rawIdea.trim() || "Une aventure magique";
    const africanHint =
      /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne/i.test(
        idea
      );
    const title = africanHint
      ? "Le baobab aux secrets doux"
      : `L'aventure de ${idea.split(" ").slice(0, 3).join(" ")}`;
    const synopsis = africanHint
      ? `Près d'un grand baobab, un petit héros malin découvre un mystère joyeux. Avec l'aide d'un ami sage, il traverse un défi tout en douceur et ramène la fête au village.`
      : `Inspiré de « ${idea} », un héros attachant part à l'aventure. Un obstacle apparaît, un ami l'aide, et tout se termine dans la joie — parfait pour colorier page après page.`;
    const castHints = africanHint
      ? ["Kofi, petit héros malin", "Mamie Ayo, grand-mère sage", "Un ami du marché"]
      : ["Le héros principal", "Un ami fidèle", "Un guide bienveillant"];
    const beats = [
      "Découverte du monde et du héros",
      "Un défi sur le chemin",
      "L'aide d'un ami",
      "La résolution joyeuse",
    ];
    const creativeBrief = [
      `Titre : ${title}`,
      `Synopsis : ${synopsis}`,
      `Personnages : ${castHints.join(" · ")}`,
      `Trame : ${beats.join(" → ")}`,
      `Idée originale : ${idea}`,
    ].join("\n");
    return { title, synopsis, castHints, beats, creativeBrief };
  }

  async buildResearchBrief(idea: string): Promise<ResearchBrief> {
    const africanHint =
      /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne/i.test(
        idea
      );
    return {
      topic: idea.slice(0, 120),
      subjectType: "invented",
      facts: ["Mode mock : pas de recherche web."],
      childSafeAngle: "Aventure douce et courageuse pour enfants.",
      culturalNotes: africanHint
        ? ["Ancrage africain / ouest-africain suggéré par l'idée."]
        : ["Suivre l'idée utilisateur (monde global / inventé)."],
      westAfricanHooks: africanHint
        ? ["Marché", "Baobab", "Foot de rue"]
        : [],
      coloringBookScenes: ["Rencontre", "Chemin", "Célébration"],
      characterVisualHints: [
        "Petit héros : short curls, simple tunic, braided bracelet",
        "Grand-mère : headwrap, long wrap skirt, walking stick",
      ],
      accuracyNotes: "Mock",
      sourcesNote: "mock",
    };
  }

  async generateStoryPlan(
    idea: string,
    pageCount: number,
    style: string,
    _research?: ResearchBrief,
    audience?: string
  ): Promise<StoryPlan> {
    const hero = idea.split(" ").slice(0, 4).join(" ") || "Petit Héros";
    const africanHint =
      /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne/i.test(
        idea
      );

    const characters = africanHint
      ? [
          {
            id: "char_1",
            name: "Kofi",
            description: "Petit héros malin du village",
            appearance:
              "Petit garçon, cheveux courts bouclés, tunique simple, bracelet tressé",
            visualLock:
              "small boy ~5 years, warm brown skin, very short tight black curls, round face, big bright eyes, short sturdy child proportions, plain short sleeveless tunic, bare feet, thin braided bracelet on left wrist — identical every page",
            personality: "Courageux, malin, gentil",
            ageBand: "child ~5",
            skinTone: "warm brown",
            hair: "very short tight black curls",
            face: "round face, big bright eyes",
            body: "short sturdy child",
            outfit: "plain short sleeveless tunic",
            signatureAccessory: "thin braided bracelet left wrist",
            proportions: "large head, short limbs",
          },
          {
            id: "char_2",
            name: "Mamie Ayo",
            description: "Grand-mère sage",
            appearance:
              "Grande-mère avec foulard noué, jupe longue, bâton de marche",
            visualLock:
              "elderly woman, warm brown skin, patterned headwrap tied high, kind wrinkled smile, long wrap skirt, simple blouse, wooden walking stick in right hand — identical every page",
            personality: "Sage et tendre",
            ageBand: "elderly",
            skinTone: "warm brown",
            hair: "patterned headwrap tied high",
            face: "kind wrinkled smile",
            body: "slight elderly frame",
            outfit: "simple blouse and long wrap skirt",
            signatureAccessory: "wooden walking stick right hand",
            proportions: "adult elderly proportions",
          },
        ]
      : [
          {
            id: "char_1",
            name: "Léo",
            description: "Le héros principal",
            appearance: "Petit animal mignon, écharpe rouge, grands yeux doux",
            visualLock:
              "cute small animal hero, round soft face, big gentle eyes, red scarf tied around neck, simple rounded body — identical every page",
            personality: "Courageux, gentil, un peu maladroit",
            ageBand: "childlike animal",
            signatureAccessory: "red scarf",
            proportions: "chibi cute proportions",
          },
        ];

    const beats = [
      "establishing",
      "action",
      "obstacle",
      "help",
      "emotion",
      "resolution",
    ] as const;

    const pages = Array.from({ length: pageCount }, (_, i) => {
      const cast =
        characters.length > 1 && i % 3 === 0
          ? characters.map((c) => c.id)
          : [characters[0]!.id];
      return {
        pageNumber: i + 1,
        title: `Chapitre ${i + 1}`,
        storyText:
          i === 0
            ? `Il était une fois ${idea.toLowerCase()}`
            : i === pageCount - 1
              ? "Et tout le monde fut fier de cette belle aventure."
              : `Notre héros continue son voyage avec courage et curiosité.`,
        illustrationDescription: `Full-body children's coloring scene ${i + 1} about: ${idea}. Style ${style}. Only cast: ${cast.join(", ")}. Rich colorable environment, clear separation, no cropped limbs.`,
        negativePrompt:
          "color, grayscale, shading, photorealism, text, watermark, extra fingers, fused fingers, floating head, cropped limbs, extra people, duplicate characters, empty white void",
        characterIds: cast.slice(0, 2),
        comicBeat: beats[Math.min(i, beats.length - 1)],
        shotType: "full_body" as const,
      };
    });

    return normalizeStoryPlan(
      {
        title: `L'aventure de ${hero}`,
        subtitle: "Un livre de coloriage magique",
        concept: `Un livre de coloriage ${style} niveau librairie pour ${audience || "enfants 4–8 ans"}, line art noir et blanc propre et imprimable, personnages cohérents de la première à la dernière page, décors riches à colorier.`,
        summary: idea,
        moral: "Croire en ses rêves",
        audienceAge: audience || "4-7 ans",
        characters,
        world: {
          setting: africanHint
            ? "Village chaleureux près du marché et du baobab"
            : "Un monde doux et coloré",
          palette: "Pastels chauds",
          mood: "Joyeux et rassurant",
        },
        pages,
      },
      pageCount
    );
  }
}

export class MockImageProvider implements ImageAIProvider {
  async generateImage(input: ImageGenerationInput) {
    const label = encodeURIComponent(
      input.isCharacterSheet
        ? "ModelSheet"
        : input.isCover
          ? "Couverture"
          : input.prompt.slice(0, 40)
    );
    const bg = input.isCover ? "a8d8ff" : "ffffff";
    const fg = input.isCover ? "1e3a5f" : "222222";
    return {
      url: `https://placehold.co/1024x1024/${bg}/${fg}/png?text=${label}`,
      provider: "mock",
    };
  }
}
