import OpenAI from "openai";

/**
 * Cœur texte de Griot — extrait éprouvé du provider MeeraDraw.
 *
 * Groq keeps a short timeout: its inference is fast, and failing over quickly
 * is the point. OpenAI is the failover of last resort — a full JSON response
 * routinely needs more than 30s there, so it gets a wide envelope (prod gen
 * 3296e412: every Groq 429/400 failover died on "Request timed out." at 30s,
 * killing the whole paid run).
 */
const GROQ_TIMEOUT_MS = 30_000;
const OPENAI_TIMEOUT_MS = 120_000;

export function createTextClient(prefer: "groq" | "openai" = "groq"): OpenAI {
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

export function resolveTextModel(prefer: "groq" | "openai" = "groq"): string {
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

export function hasTextProviderKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export function hasOpenAIFailover(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim());
}

export type ChatParams = Omit<
  Parameters<OpenAI["chat"]["completions"]["create"]>[0],
  "model"
> & { model?: string };

/** Run a chat completion; on primary (Groq) failure, retry once on OpenAI. */
export async function chatJsonCompletion(
  primary: OpenAI,
  primaryModel: string,
  params: ChatParams
): Promise<string> {
  try {
    const response = await primary.chat.completions.create({
      ...params,
      model: params.model || primaryModel,
    } as Parameters<OpenAI["chat"]["completions"]["create"]>[0]);
    const content = "choices" in response ? response.choices[0]?.message?.content : null;
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
    const content = "choices" in response ? response.choices[0]?.message?.content : null;
    if (!content) throw new Error("Empty text provider response (OpenAI failover)");
    return content;
  }
}

/** Complétion JSON avec le client par défaut (Groq d'abord, OpenAI en secours). */
export async function completeJson(params: ChatParams): Promise<string> {
  return chatJsonCompletion(createTextClient(), resolveTextModel(), params);
}
