/**
 * Optional web research for story grounding.
 * Uses Tavily / Serper when keys exist; otherwise DuckDuckGo Instant Answer (no key);
 * finally returns null so the LLM uses a strong knowledge-only brief.
 */

export type ResearchSource = "tavily" | "serper" | "duckduckgo" | "none";

export interface WebResearchResult {
  source: ResearchSource;
  query: string;
  snippets: string[];
  /** Flattened context for LLM prompts */
  context: string | null;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function searchTavily(query: string, apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: 5,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; content?: string; url?: string }>;
  };
  const snippets: string[] = [];
  if (data.answer) snippets.push(truncate(data.answer, 500));
  for (const r of data.results ?? []) {
    const bit = [r.title, r.content].filter(Boolean).join(" — ");
    if (bit) snippets.push(truncate(bit, 400));
  }
  return snippets;
}

async function searchSerper(query: string, apiKey: string): Promise<string[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = (await res.json()) as {
    answerBox?: { snippet?: string; title?: string; answer?: string };
    knowledgeGraph?: { description?: string; title?: string };
    organic?: Array<{ title?: string; snippet?: string }>;
  };
  const snippets: string[] = [];
  if (data.answerBox) {
    const ab = [data.answerBox.title, data.answerBox.answer, data.answerBox.snippet]
      .filter(Boolean)
      .join(" — ");
    if (ab) snippets.push(truncate(ab, 500));
  }
  if (data.knowledgeGraph?.description) {
    snippets.push(
      truncate(
        `${data.knowledgeGraph.title ?? ""}: ${data.knowledgeGraph.description}`,
        500
      )
    );
  }
  for (const r of data.organic ?? []) {
    const bit = [r.title, r.snippet].filter(Boolean).join(" — ");
    if (bit) snippets.push(truncate(bit, 400));
  }
  return snippets;
}

/** Free, no API key — Instant Answer API (limited but useful for public figures). */
async function searchDuckDuckGo(query: string): Promise<string[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractSource?: string;
    Heading?: string;
    Answer?: string;
    RelatedTopics?: Array<{ Text?: string; Topics?: Array<{ Text?: string }> }>;
  };

  const snippets: string[] = [];
  if (data.Heading && data.AbstractText) {
    snippets.push(
      truncate(`${data.Heading} (${data.AbstractSource || "DDG"}): ${data.AbstractText}`, 600)
    );
  } else if (data.AbstractText) {
    snippets.push(truncate(data.AbstractText, 600));
  }
  if (data.Answer) snippets.push(truncate(data.Answer, 400));

  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Text) snippets.push(truncate(topic.Text, 300));
    for (const sub of topic.Topics ?? []) {
      if (sub.Text) snippets.push(truncate(sub.Text, 300));
    }
    if (snippets.length >= 6) break;
  }

  return snippets.slice(0, 6);
}

/**
 * Requête factuelle pour ancrer un récit d'histoire vraie (dates, faits, noms).
 */
export function buildSearchQuery(idea: string): string {
  const cleaned = idea.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${cleaned} histoire vraie faits dates chronologie`;
}

/**
 * Gather web snippets if possible. Never throws — graceful degradation.
 */
export async function gatherWebResearch(idea: string): Promise<WebResearchResult> {
  const query = buildSearchQuery(idea);
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const serperKey = process.env.SERPER_API_KEY?.trim();

  const tryProviders: Array<{
    source: ResearchSource;
    run: () => Promise<string[]>;
  }> = [];

  if (tavilyKey) {
    tryProviders.push({ source: "tavily", run: () => searchTavily(query, tavilyKey) });
  }
  if (serperKey) {
    tryProviders.push({ source: "serper", run: () => searchSerper(query, serperKey) });
  }
  // Free fallback when no paid key (or after paid failures)
  tryProviders.push({ source: "duckduckgo", run: () => searchDuckDuckGo(idea.slice(0, 120)) });

  for (const provider of tryProviders) {
    try {
      const snippets = await provider.run();
      if (snippets.length > 0) {
        return {
          source: provider.source,
          query,
          snippets,
          context: snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n"),
        };
      }
    } catch (err) {
      console.warn(`[research] ${provider.source} failed:`, err);
    }
  }

  return { source: "none", query, snippets: [], context: null };
}
