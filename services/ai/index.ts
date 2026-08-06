import { FalImageProvider } from "@/services/ai/fal-provider";
import { MockImageProvider, MockTextProvider } from "@/services/ai/mock-provider";
import { OpenAITextProvider } from "@/services/ai/openai-provider";
import type { ImageAIProvider, TextAIProvider } from "@/services/ai/types";

export function getTextProvider(): TextAIProvider {
  const hasTextKey = Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
  const mock = process.env.MOCK_AI === "true" || !hasTextKey;
  return mock ? new MockTextProvider() : new OpenAITextProvider();
}

export function getImageProvider(): ImageAIProvider {
  const mock = process.env.MOCK_AI === "true" || !process.env.FAL_KEY;
  return mock ? new MockImageProvider() : new FalImageProvider();
}

export * from "@/services/ai/types";
export { gatherWebResearch, buildSearchQuery } from "@/services/ai/research";
export {
  buildColoringPagePrompt,
  buildCoverPrompt,
  buildCharacterSheetPrompt,
  buildReferenceGuidedScenePrompt,
  buildStorySystemPrompt,
  buildResearchSystemPrompt,
  buildEnrichIdeaSystemPrompt,
  buildEnrichIdeaUserPrompt,
  CREATIVE_DIRECTOR_ROLE,
} from "@/services/ai/prompts";
export {
  formatCharacterLock,
  formatPageCharacterLock,
  normalizeStoryPlan,
} from "@/services/ai/character-bible";
