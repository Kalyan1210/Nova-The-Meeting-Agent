import { env } from "../../config/env.js";

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Search the web using the Tavily API and return the top results.
 * Tavily is optimised for LLM consumption — results include clean
 * extracted content rather than raw HTML.
 */
export async function searchWeb(
  query: string,
  maxResults = 3
): Promise<WebSearchResult[]> {
  const apiKey = env.tavily.apiKey;
  if (!apiKey) {
    throw new Error(
      "TAVILY_API_KEY is not configured. Add it to .env to enable web search."
    );
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tavily search failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}
