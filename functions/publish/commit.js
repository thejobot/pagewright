/**
 * Publish / save a studio-edited page (and any accompanying assets) to
 * the configured GitHub repo as a single atomic commit + PR.
 *
 * POST /publish/commit
 *
 * Body shapes:
 *   { mode: "create", slug, html, assets? }
 *     → writes <PUBLISH_PATH_PATTERN with {slug} substituted> on branch
 *       studio/<slug>-<shortSha>.
 *
 *   { mode: "edit", path, sha, html, assets? }
 *     → updates the file at path on branch studio/edit-<safePath>-<shortSha>.
 *
 *   assets: [{ path, base64 }]
 *     → extra files to commit alongside the HTML. base64 is the raw bytes
 *       (binary-safe). path must match ^[a-zA-Z0-9_\-./]+$ and not contain "..".
 *
 * Everything goes through the Trees API so the HTML update + asset uploads
 * land as one commit, not N separate commits. If a PR already exists for the
 * branch it's reused (new commit pushed), otherwise a new PR opens.
 *
 * Env bindings:
 *   GITHUB_TOKEN: fine-grained PAT with contents:rw + pull_requests:rw
 *   GITHUB_REPO: "owner/repo" (required)
 *   PUBLISH_PATH_PATTERN: optional, defaults to "pages/{slug}/index.html"
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-gh-token",
};

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;
const PATH_RE = /^[a-zA-Z0-9_\-./]+$/;

function validateHtml(html) {
  if (typeof html !== "string" || html.length < 100 || html.length > 2_000_000) {
    return "html missing or out of range";
  }
  if (/<script\s+[^>]*src\s*=\s*["']https?:\/\/(?!fonts\.googleapis\.com|unpkg\.com|cdn\.jsdelivr\.net)/i.test(html)) {
    return "external script source not allow-listed";
  }
  return null;
}

function safeBranchSegment(s) {
  return s.replaceAll("/", "-").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 60);
}

function utf8ToBase64(str) {
  // Keep multi-byte UTF-8 intact. btoa(unescape(encodeURIComponent(x)))
  // is the legacy pattern; the modern TextEncoder variant is a touch
  // cleaner and avoids the deprecation footprint of escape/unescape.
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function commitFiles({ gh, repo, files, message, branch, baseSha }) {
  // 1) Base tree
  const baseCommitRes = await gh(`/repos/${repo}/git/commits/${baseSha}`);
  if (!baseCommitRes.ok) throw new Error(`base commit ${baseCommitRes.status}`);
  const baseTreeSha = (await baseCommitRes.json()).tree.sha;

  // 2) Create a blob per file
  const treeEntries = [];
  for (const f of files) {
    const blobRes = await gh(`/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: f.base64, encoding: "base64" }),
    });
    if (!blobRes.ok) throw new Error(`blob ${f.path}: ${await blobRes.text()}`);
    const blob = await blobRes.json();
    treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 3) Tree
  const treeRes = await gh(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`tree: ${await treeRes.text()}`);
  const tree = await treeRes.json();

  // 4) Commit
  const commitRes = await gh(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
  });
  if (!commitRes.ok) throw new Error(`commit: ${await commitRes.text()}`);
  const commit = await commitRes.json();

  // 5) Branch: update if it exists, else create
  const refRes = await gh(`/repos/${repo}/git/ref/heads/${branch}`);
  if (refRes.ok) {
    const updRes = await gh(`/repos/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (!updRes.ok) throw new Error(`branch update: ${await updRes.text()}`);
  } else {
    const crRes = await gh(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
    if (!crRes.ok) throw new Error(`branch create: ${await crRes.text()}`);
  }

  return { commitSha: commit.sha };
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }

  const mode = body?.mode === "edit" ? "edit" : "create";
  const html = body?.html;
  const htmlErr = validateHtml(html);
  if (htmlErr) return json({ ok: false, error: htmlErr }, 400);

  const repo = context.env.GITHUB_REPO;
  if (!repo) return json({ ok: false, error: "GITHUB_REPO env var not set" }, 500);
  const pathPattern = context.env.PUBLISH_PATH_PATTERN || "pages/{slug}/index.html";
  const token = context.request.headers.get("x-gh-token") || context.env.GITHUB_TOKEN;
  if (!token || token === "PASTE_TOKEN_HERE") {
    return json({ ok: false, error: "NO_GH_TOKEN" }, 401);
  }

  const gh = (path, init = {}) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "studio",
        ...(init.headers || {}),
      },
    });

  // Resolve target path + branch name per mode.
  let htmlPath, branchBase, prTitle;
  if (mode === "edit") {
    htmlPath = String(body?.path || "");
    if (!PATH_RE.test(htmlPath) || htmlPath.includes("..")) return json({ ok: false, error: "invalid path" }, 400);
    branchBase = `edit-${safeBranchSegment(htmlPath)}`;
    prTitle = `Studio: edit ${htmlPath}`;
  } else {
    const slug = String(body?.slug || "");
    if (!SLUG_RE.test(slug)) return json({ ok: false, error: "invalid slug" }, 400);
    htmlPath = pathPattern.replaceAll("{slug}", slug);
    if (!PATH_RE.test(htmlPath) || htmlPath.includes("..")) {
      return json({ ok: false, error: "invalid PUBLISH_PATH_PATTERN result" }, 500);
    }
    branchBase = slug;
    prTitle = `Studio: add ${slug}`;
  }

  // Assemble the file list: HTML first, then any assets.
  const files = [{ path: htmlPath, base64: utf8ToBase64(html) }];
  const assets = Array.isArray(body?.assets) ? body.assets : [];
  for (const a of assets) {
    if (typeof a?.path !== "string" || typeof a?.base64 !== "string") continue;
    if (!PATH_RE.test(a.path) || a.path.includes("..")) {
      return json({ ok: false, error: `invalid asset path: ${a.path}` }, 400);
    }
    if (a.base64.length > 14_000_000) {
      return json({ ok: false, error: `asset too large: ${a.path}` }, 400);
    }
    files.push({ path: a.path, base64: a.base64 });
  }

  try {
    const mainRefRes = await gh(`/repos/${repo}/git/ref/heads/main`);
    if (!mainRefRes.ok) return json({ ok: false, error: `main ref ${mainRefRes.status}` }, 500);
    const baseSha = (await mainRefRes.json()).object.sha;
    const branch = `studio/${branchBase}-${baseSha.slice(0, 7)}`;

    const commitMessage = assets.length
      ? `${prTitle} (+ ${assets.length} asset${assets.length > 1 ? "s" : ""})`
      : prTitle;

    await commitFiles({ gh, repo, files, message: commitMessage, branch, baseSha });

    // Find existing PR for branch, or open a new one.
    const owner = repo.split("/")[0];
    const listRes = await gh(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(owner + ":" + branch)}`);
    const existing = listRes.ok ? await listRes.json() : [];
    let pr;
    if (existing.length) {
      pr = existing[0];
    } else {
      const prRes = await gh(`/repos/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: prTitle,
          head: branch,
          base: "main",
          body: `Generated by studio.\n\nMode: \`${mode}\`\nPath: \`${htmlPath}\`${
            assets.length ? `\nAssets: ${assets.map(a => `\`${a.path}\``).join(", ")}` : ""
          }`,
        }),
      });
      pr = await prRes.json();
      if (!prRes.ok) return json({ ok: false, error: `PR failed: ${pr.message}` }, 500);
    }

    return json({
      ok: true,
      mode,
      branch,
      path: htmlPath,
      assets: assets.map(a => a.path),
      pr_url: pr.html_url,
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
