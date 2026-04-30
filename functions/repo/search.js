/**
 * GitHub code search across the configured repo.
 *
 * GET /repo/search?q=<query>
 *
 * Env bindings (Cloudflare Pages):
 *   GITHUB_TOKEN: fine-grained PAT with read access to the repo
 *   GITHUB_REPO: e.g. "owner/repo" (required)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ ok: false, error: "missing q" }, 400);

  const repo = context.env.GITHUB_REPO;
  if (!repo) return json({ ok: false, error: "GITHUB_REPO env var not set" }, 500);
  const token = context.request.headers.get("x-gh-token") || context.env.GITHUB_TOKEN;
  if (!token || token === "PASTE_TOKEN_HERE") {
    return json({ ok: false, error: "NO_GH_TOKEN" }, 401);
  }

  const search = `${q} repo:${repo}`;
  const res = await fetch(
    `https://api.github.com/search/code?q=${encodeURIComponent(search)}&per_page=15`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "studio",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    return json({ ok: false, error: `GitHub ${res.status}: ${text}` }, res.status);
  }
  const data = await res.json();
  const results = (data.items || []).map((it) => ({
    path: it.path,
    url: it.html_url,
    snippet: it.text_matches?.[0]?.fragment || "",
  }));
  return json({ ok: true, results });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
