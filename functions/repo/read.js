/**
 * Read a single file from the configured GitHub repo.
 *
 * GET /repo/read?path=<relative/path.html>
 *
 * Env bindings: GITHUB_TOKEN, GITHUB_REPO (required, e.g. "owner/repo").
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
  const path = (url.searchParams.get("path") || "").trim();
  if (!path) return json({ ok: false, error: "missing path" }, 400);
  if (path.includes("..")) return json({ ok: false, error: "invalid path" }, 400);

  const repo = context.env.GITHUB_REPO;
  if (!repo) return json({ ok: false, error: "GITHUB_REPO env var not set" }, 500);
  const token = context.request.headers.get("x-gh-token") || context.env.GITHUB_TOKEN;
  if (!token || token === "PASTE_TOKEN_HERE") {
    return json({ ok: false, error: "NO_GH_TOKEN" }, 401);
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "pagewright",
      },
    }
  );
  if (!res.ok) {
    return json({ ok: false, error: `GitHub ${res.status}` }, res.status);
  }
  const data = await res.json();
  if (data.type !== "file") return json({ ok: false, error: "not a file" }, 400);

  // GitHub returns base64 of the raw bytes; decode *as UTF-8* so Japanese
  // (and any multi-byte content) round-trips correctly. Raw atob() leaves you
  // with a binary string of char codes 0–255, which then gets serialized into
  // mojibake by JSON.stringify. TextDecoder handles the UTF-8 pass.
  const b64 = data.content.replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return json({ ok: true, path, sha: data.sha, content });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
