import { normalizeStoryPlan } from "@/services/ai/character-bible";
import type {
  EnrichedIdea,
  ImageAIProvider,
  ImageGenerationInput,
  ResearchBrief,
  SettingBible,
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
    audience?: string,
    opts?: {
      originalIdea?: string;
      childName?: string;
      childGender?: string;
      parentMode?: boolean;
    }
  ): Promise<StoryPlan> {
    const source = opts?.originalIdea || idea;
    const hero =
      opts?.childName ||
      source.split(" ").slice(0, 4).join(" ") ||
      "Petit Héros";
    const africanHint =
      /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne|west_african|folklore_wa/i.test(
        `${source} ${style}`
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

  async generateSettingBible(params: {
    universeTitle: string;
    universeDescription?: string;
    worldSetting?: string;
    style?: string;
  }): Promise<SettingBible> {
    const africanHint =
      /afrique|baobab|dakar|abidjan|lagos|kirikou|anansi|accra|savane|niger|pagne/i.test(
        `${params.universeTitle} ${params.universeDescription || ""} ${params.worldSetting || ""}`
      );
    if (africanHint) {
      return {
        worldSummary: "warm rural West African savanna village",
        elements: [
          "giant baobab tree",
          "round banco clay houses with thatched roofs",
          "open-air market stalls",
          "wax-print fabrics drying on a line",
          "calabash bowls",
          "red laterite dirt path",
          "tall savanna grass",
          "clay water jars",
        ],
        forbiddenElements: [
          "European suburban houses",
          "modern glass windows",
          "paved city streets",
        ],
      };
    }
    return {
      worldSummary: "soft storybook world",
      elements: [
        "rolling hills",
        "friendly round trees",
        "winding path",
        "wooden fence",
        "small flowers",
        "fluffy clouds",
        "little wooden house",
        "stone bridge",
      ],
      forbiddenElements: ["skyscrapers", "cars", "power lines"],
    };
  }
}

export class MockImageProvider implements ImageAIProvider {
  /**
   * Synthesize an image that satisfies the REAL downstream gates instead of a
   * flat placeholder (which the plausibility check and the final raster gate
   * rightly reject: "0% ink" pages, "no white" covers):
   *  - coloring pages: white background + black line work (~5% ink);
   *  - character sheets: colored figure on white (colored + non-blank);
   *  - covers: colored scene with a calm white title band.
   * The PNG is uploaded to our own Storage (emulator or real) — no external
   * host, no provider cost.
   */
  async generateImage(input: ImageGenerationInput) {
    const { default: sharp } = await import("sharp");
    const { randomUUID } = await import("crypto");
    const label = (
      input.isCharacterSheet
        ? "SHEET"
        : input.isCover
          ? "COVER"
          : input.prompt.slice(0, 24)
    ).replace(/[<>&"]/g, "");
    const body = input.isCharacterSheet
      ? `<rect width="1024" height="1024" fill="white"/>
         <circle cx="512" cy="380" r="180" fill="#e8b06b" stroke="black" stroke-width="14"/>
         <rect x="362" y="560" width="300" height="320" rx="40" fill="#4caf50" stroke="black" stroke-width="14"/>
         <circle cx="452" cy="350" r="22" fill="black"/>
         <circle cx="572" cy="350" r="22" fill="black"/>
         <path d="M 440 450 Q 512 510 584 450" stroke="black" stroke-width="14" fill="none"/>`
      : input.isCover
        ? `<rect width="1024" height="1024" fill="white"/>
           <rect y="560" width="1024" height="464" fill="#a8d8ff"/>
           <circle cx="512" cy="760" r="150" fill="#ffd54f" stroke="black" stroke-width="12"/>
           <rect x="140" y="940" width="744" height="60" fill="#66bb6a"/>`
        : `<rect width="1024" height="1024" fill="white"/>
           <g stroke="black" stroke-width="16" fill="none">
             <circle cx="512" cy="400" r="220"/>
             <circle cx="430" cy="360" r="24"/>
             <circle cx="594" cy="360" r="24"/>
             <path d="M 420 470 Q 512 540 604 470"/>
             <rect x="220" y="680" width="584" height="220" rx="30"/>
             <path d="M 60 950 L 964 950"/>
             <path d="M 120 120 Q 200 60 280 120"/>
             <path d="M 744 120 Q 824 60 904 120"/>
           </g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${body}
      <text x="512" y="1000" font-size="28" text-anchor="middle" fill="black">${label}</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    try {
      const { StorageService } = await import("@/services/storage-service");
      const url = await new StorageService().uploadBytes(
        `mock/${randomUUID()}.png`,
        png,
        "image/png"
      );
      return { url, provider: "mock" };
    } catch {
      // No Storage available (pure logic tests, CI without emulator):
      // fall back to the historical placeholder URL — enough for tests that
      // never fetch the bytes.
      return {
        url: `https://placehold.co/1024x1024/ffffff/222222/png?text=${encodeURIComponent(label)}`,
        provider: "mock",
      };
    }
  }
}
