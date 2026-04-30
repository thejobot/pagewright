/**
 * Claude tool-use loop for Studio's AI panel. Optional — only mount this
 * function if you want the AI assist surface. Without ANTHROPIC_API_KEY set,
 * any call to /ai/chat will return a 500.
 *
 * POST /ai/chat
 * Body: { messages: [{role, content}, ...] }
 *
 * Responds with { ok, message, tool_events[] } after the agent finishes.
 *
 * Tools exposed to Claude:
 *   search_repo    → GitHub code search (reuses /repo/search)
 *   read_repo_file → GitHub file read (reuses /repo/read)
 *   wire_element   → suggest an onclick/handler snippet (stateless)
 *   publish_page   → commit + open PR (reuses /publish/commit)
 *
 * Env bindings:
 *   ANTHROPIC_API_KEY — Anthropic API key (required for this endpoint)
 *   ANTHROPIC_MODEL   — defaults to "claude-sonnet-4-6"
 *   GITHUB_TOKEN, GITHUB_REPO — passed through for tool implementations
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const SYSTEM_PROMPT = `You are Studio's publishing assistant. The user designs pages
visually in GrapesJS; your job is the *plumbing*. You help by:
  • finding files in the configured GitHub repo
  • suggesting how to wire interactive elements to existing patterns in the repo
  • publishing finished pages as a PR

Conventions:
  • vanilla HTML and inline <style>; no npm or framework runtime is assumed.
  • when injecting an apostrophe inside an onclick string, use \\x27 — not
    &#x27;. The HTML entity will render literally.
  • follow design-token names found in styles/tokens.css (read it via tools
    when needed) rather than inventing colors.

Be concise. Use tools freely. Always confirm destructive actions (publish)
with the user before calling them.`;

const TOOLS = [
  {
    name: "search_repo",
    description: "Search the configured GitHub repo for a substring or filename. Returns a list of paths and snippets.",
    input_schema: {
      type: "object",
      properties: { q: { type: "string", description: "GitHub code-search query" } },
      required: ["q"],
    },
  },
  {
    name: "read_repo_file",
    description: "Read one file from the configured GitHub repo. Returns its raw content.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "wire_element",
    description: "Given a plain-English intent for an interactive element, propose an onclick or handler snippet grounded in the repo's conventions.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "What should the element do when tapped?" },
        element_id: { type: "string", description: "Optional id of the element" },
      },
      required: ["intent"],
    },
  },
  {
    name: "publish_page",
    description: "Commit an exported HTML page to the configured publish path on a new branch and open a PR.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        html: { type: "string" },
      },
      required: ["slug", "html"],
    },
  },
];

async function runTool(name, args, origin, env) {
  if (name === "search_repo") {
    const res = await fetch(`${origin}/repo/search?q=${encodeURIComponent(args.q)}`);
    return await res.json();
  }
  if (name === "read_repo_file") {
    const res = await fetch(`${origin}/repo/read?path=${encodeURIComponent(args.path)}`);
    return await res.json();
  }
  if (name === "wire_element") {
    return {
      ok: true,
      suggestion: `// Stub — the model itself writes the snippet; this tool echoes the intent.\n// intent: ${args.intent}\n// element_id: ${args.element_id || "(unknown)"}`,
    };
  }
  if (name === "publish_page") {
    const res = await fetch(`${origin}/publish/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: args.slug, html: args.html }),
    });
    return await res.json();
  }
  return { ok: false, error: `unknown tool ${name}` };
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages) return json({ ok: false, error: "messages required" }, 400);

  const apiKey = context.env.ANTHROPIC_API_KEY;
  const model = context.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  if (!apiKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500);

  const origin = new URL(context.request.url).origin;
  const toolEvents = [];
  const convo = [...messages];

  for (let step = 0; step < 6; step++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: convo,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return json({ ok: false, error: `Anthropic ${resp.status}: ${text}` }, 500);
    }
    const data = await resp.json();

    if (data.stop_reason !== "tool_use") {
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      return json({ ok: true, message: text, tool_events: toolEvents });
    }

    const toolUses = (data.content || []).filter(b => b.type === "tool_use");
    convo.push({ role: "assistant", content: data.content });
    const toolResults = [];
    for (const tu of toolUses) {
      const out = await runTool(tu.name, tu.input, origin, context.env);
      toolEvents.push({ name: tu.name, input: tu.input, output: out });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(out).slice(0, 20_000),
      });
    }
    convo.push({ role: "user", content: toolResults });
  }

  return json({ ok: false, error: "tool loop exceeded", tool_events: toolEvents }, 500);
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
