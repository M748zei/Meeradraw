import type { BookType } from "@/types/database";

export const BOOK_TYPES: Array<{
  id: BookType;
  name: string;
  description: string;
  available: boolean;
  estimatedMinutes: number;
}> = [
  {
    id: "colorbook",
    name: "Livre de coloriage",
    description: "Illustrations en contours, parfaites pour colorier",
    available: true,
    estimatedMinutes: 2,
  },
  {
    id: "storybook",
    name: "Histoire illustrée",
    description: "Une histoire complète avec de belles illustrations",
    available: false,
    estimatedMinutes: 3,
  },
  {
    id: "activitybook",
    name: "Cahier d'activités",
    description: "Labyrinthes, quiz et jeux éducatifs",
    available: false,
    estimatedMinutes: 3,
  },
  {
    id: "workbook",
    name: "Livre éducatif",
    description: "Apprentissage progressif adapté à l'âge",
    available: false,
    estimatedMinutes: 4,
  },
];

export const PAGE_OPTIONS = [6, 8, 12, 16, 20, 24, 25] as const;

export const STYLE_OPTIONS = [
  {
    id: "simple",
    name: "Dessin simple",
    description: "Traits épais, grandes zones, idéal débutants",
  },
  {
    id: "kawaii",
    name: "Kawaii",
    description: "Mignon, formes rondes, silhouettes claires",
  },
  {
    id: "cartoon",
    name: "Cartoon / BD",
    description: "Poses expressives, lisibilité BD jeunesse",
  },
  {
    id: "cute",
    name: "Mignon",
    description: "Chaleureux, proportions enfantines stables",
  },
  {
    id: "adventure",
    name: "Aventure",
    description: "Action claire, un focal par page",
  },
  {
    id: "fantasy",
    name: "Fantasy",
    description: "Magie douce, décors simples à colorier",
  },
  {
    id: "west_african",
    name: "Afrique de l'Ouest",
    description:
      "Visages et décors Afrique de l'Ouest — obligatoire (teint, coiffure, tenue, marchés / baobabs)",
  },
  {
    id: "folklore_wa",
    name: "Conte africain",
    description:
      "Visages et décors Afrique de l'Ouest — obligatoire ; petit héros malin, village, magie douce",
  },
] as const;

/** Global classics + African / West African enrichment (ADD, don't replace). */
export const IDEA_EXAMPLES = [
  "Un petit renard qui rêve de devenir chef cuisinier.",
  "Une princesse qui déteste les châteaux.",
  "Une tortue qui construit une fusée.",
  "Un petit robot qui apprend les émotions.",
  "Un lionceau courageux qui veut devenir roi de la savane malgré sa peur.",
  "L'histoire de Messi, champion du monde, racontée pour les enfants.",
  "Un petit héros malin, style Kirikou, sauve son village près du fleuve Niger.",
  "Awa découvre un baobab magique au marché de Dakar.",
  "Match de foot de rue à Abidjan : l'équipe des enfants contre les grands.",
  "Anansi le malin (conte respectueux) aide un ami perdu dans la savane.",
];
