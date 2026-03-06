import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const log = (msg: string) => process.stderr.write(`[tide:web-search] ${msg}\n`);

export default function tideWebSearch(pi: ExtensionAPI) {
  const apiKey = process.env.TAVILY_API_KEY;
  log(`Extension loaded, API key configured: ${!!apiKey}`);

  if (!apiKey) {
    log("No TAVILY_API_KEY found — web search tools will not be registered");
    return;
  }

  // Inject system prompt about web search
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!process.env.TAVILY_API_KEY) return;
    return {
      systemPrompt:
        (_event as any).systemPrompt +
        `\n\n## Web Search Available\n\n` +
        `You have web search capabilities via Tavily. Use these tools when you need current information:\n` +
        `- web_search: Search the web for current information, documentation, APIs, etc.\n` +
        `- web_extract: Extract clean content from a specific URL.\n` +
        `Use web search when the user asks about recent events, current docs, or anything beyond your training data.\n` +
        `IMPORTANT: After calling web_search or web_extract, you MUST always provide a text response summarizing the findings for the user. Never end your turn with just a tool call.\n`,
    };
  });

  // Tool: Web Search
  pi.registerTool({
    name: "web_search",
    description:
      "Search the web for current information. Returns relevant results with titles, URLs, and content snippets. Use this when you need up-to-date information, documentation, or answers to questions beyond your training data.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(
        Type.Number({
          description: "Maximum number of results (default 5, max 10)",
        }),
      ),
      searchDepth: Type.Optional(
        Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
          description:
            "Search depth: 'basic' is fast, 'advanced' is more thorough (default: basic)",
        }),
      ),
      includeAnswer: Type.Optional(
        Type.Boolean({
          description:
            "Include a short AI-generated answer summary (default: true)",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web search not available. Set your Tavily API key in Settings > Provider Keys.",
            },
          ],
          isError: true,
        };
      }

      try {
        const maxResults = Math.min(params.maxResults || 5, 10);
        const body = {
          api_key: key,
          query: params.query,
          max_results: maxResults,
          search_depth: params.searchDepth || "basic",
          include_answer: params.includeAnswer !== false,
          include_raw_content: false,
        };

        log(`Searching: "${params.query}" (depth: ${body.search_depth}, max: ${maxResults})`);

        const resp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          log(`Search failed: ${resp.status} ${errText}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `Web search failed (${resp.status}): ${errText}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await resp.json()) as {
          answer?: string;
          results: {
            title: string;
            url: string;
            content: string;
            score: number;
          }[];
        };

        // Format results concisely for the LLM
        let output = "";
        if (data.answer) {
          output += `**Answer:** ${data.answer}\n\n`;
        }
        output += `**Results (${data.results.length}):**\n\n`;
        for (const r of data.results) {
          output += `### ${r.title}\n`;
          output += `${r.url}\n`;
          output += `${r.content}\n\n`;
        }

        log(`Got ${data.results.length} results`);

        return {
          content: [{ type: "text" as const, text: output.trim() }],
          details: { resultCount: data.results.length },
        };
      } catch (err: any) {
        if (err.name === "AbortError") {
          return {
            content: [
              { type: "text" as const, text: "Search was cancelled." },
            ],
            isError: true,
          };
        }
        log(`Search error: ${err.message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Web search error: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // Tool: Web Extract (fetch + extract content from a URL)
  pi.registerTool({
    name: "web_extract",
    description:
      "Extract clean, readable content from a specific URL. Use this to read documentation pages, articles, or any web page. Returns the page content as clean text.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to extract content from" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const key = process.env.TAVILY_API_KEY;
      if (!key) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Web extract not available. Set your Tavily API key in Settings > Provider Keys.",
            },
          ],
          isError: true,
        };
      }

      try {
        log(`Extracting: ${params.url}`);

        const resp = await fetch("https://api.tavily.com/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            urls: [params.url],
          }),
          signal,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Unknown error");
          log(`Extract failed: ${resp.status} ${errText}`);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to extract content (${resp.status}): ${errText}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await resp.json()) as {
          results: { url: string; raw_content: string }[];
        };

        if (!data.results || data.results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No content could be extracted from the URL.",
              },
            ],
          };
        }

        const content = data.results[0].raw_content;
        // Truncate if too long to avoid blowing up context
        const maxChars = 30000;
        const truncated =
          content.length > maxChars
            ? content.slice(0, maxChars) + "\n\n[Content truncated at 30,000 characters]"
            : content;

        log(`Extracted ${content.length} chars from ${params.url}`);

        return {
          content: [{ type: "text" as const, text: truncated }],
          details: { charCount: content.length, truncated: content.length > maxChars },
        };
      } catch (err: any) {
        if (err.name === "AbortError") {
          return {
            content: [
              { type: "text" as const, text: "Extraction was cancelled." },
            ],
            isError: true,
          };
        }
        log(`Extract error: ${err.message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Web extract error: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
