/**
 * List files in the configured GitHub repo.
 *
 * GET /repo/tree?pattern=.html
 *   pattern: optional. A substring or suffix filter applied to paths.
 *
 * Returns { ok, files: [{ path, sha, size }] } from the main branch tree.
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
  const pattern = (url.searchParams.get("pattern") || "").trim();

  const repo = context.env.GITHUB_REPO;
  if (!repo) return json({ ok: false, error: "GITHUB_REPO env var not set" }, 500);
  const token = context.request.headers.get("x-gh-token") || context.env.GITHUB_TOKEN;
  if (!token || token === "PASTE_TOKEN_HERE") {
    return json({ ok: false, error: "NO_GH_TOKEN" }, 401);
  }

  const gh = (path) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "pagewright",
      },
    });

  try {
    const refRes = await gh(`/repos/${repo}/git/ref/heads/main`);
    if (!refRes.ok) return json({ ok: false, error: `ref ${refRes.status}` }, 500);
    const ref = await refRes.json();

    const treeRes = await gh(`/repos/${repo}/git/trees/${ref.object.sha}?recursive=1`);
    if (!treeRes.ok) return json({ ok: false, error: `tree ${treeRes.status}` }, 500);
    const tree = await treeRes.json();

    const files = (tree.tree || [])
      .filter((e) => e.type === "blob")
      .filter((e) => (pattern ? e.path.includes(pattern) : true))
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size }));

    return json({ ok: true, files, truncated: !!tree.truncated });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
