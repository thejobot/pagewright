# pagewright

> Enhance your vibe-coding with hands-on edits and richer context for the next prompt.

When Claude (or whatever LLM you're using) writes an SVG, a layout, or a
whole page for you, the next round is often the painful part. Two things
work against you:

- **The model can't see what it rendered.** Even when you screenshot it
  back, it usually can't tell which particular `<rect>` or `<div>` you
  mean, and the fix-by-description loop drifts.
- **You can't easily hand the model precise context** about the part you
  care about — the selector, the surrounding markup, the handlers and
  styles in play. So your prompt is vaguer than it needs to be, and the
  next pass overshoots.

Pagewright sits between you and the artifact. Open any HTML file from your
GitHub repo into a visual editor built on [GrapesJS](https://grapesjs.com/)
and either:

- **Nudge by hand** — click the thing, drag it where it should go, save the
  edit back as a PR. The kind of pixel-level move you'd spend three messages
  trying to describe.
- **Pull sharper context** — the layer tree, find-in-repo panel, and
  actions inspector surface the structure, surrounding files, and event
  wiring of whatever you've selected. Paste that into your next prompt
  instead of "the blue thing on the left."

No build step, vanilla ES modules, deploys to Cloudflare Pages.

## What you get

- A GrapesJS editor pre-wired with a small set of generic blocks
  (hero card, callout, audio embed, section divider).
- **Open** any HTML file in the configured repo into the canvas for visual
  editing.
- **Save** commits the edited HTML back to the same path on a per-file branch,
  reusing an open PR if one exists.
- **Publish** writes a new page on a per-slug branch and opens a PR.
- **Find** runs GitHub code search across the repo from a side panel.
- **Export** downloads the assembled HTML without touching GitHub.
- Optional AI assist panel that hits the Claude API via `/ai/chat` to help wire
  interactive elements; off by default until `ANTHROPIC_API_KEY` is set.

## Layout

```
.
├── index.html                ← editor UI
├── studio.js                 ← bootstrap: GrapesJS init, topbar, find-in-repo
├── blocks/
│   ├── index.js              ← registers the default block pack
│   ├── hero-card.js
│   ├── callout.js
│   ├── embed.js
│   ├── section-divider.js
│   └── karaoke/              ← opt-in example pack (see below)
├── styles/
│   ├── tokens.css            ← design tokens (colors, surfaces)
│   ├── blocks.css            ← block styles (inlined into export)
│   └── blocks-karaoke.css    ← styles for the opt-in karaoke pack
├── templates/
│   └── page-skeleton.html    ← wrapper used when exporting
├── functions/                ← Cloudflare Pages Functions
│   ├── ai/chat.js            ← optional Claude tool-use loop
│   ├── repo/{tree,read,search}.js  ← read sides of the GitHub round-trip
│   └── publish/commit.js     ← commit HTML + assets, open or reuse a PR
└── agent/
    ├── system-prompt.md      ← human-readable copy of the AI system prompt
    └── tools.json            ← tool manifest mirror
```

## Local dev

**Canvas only (no Pages Functions):**

```bash
python3 -m http.server 8765
# open http://localhost:8765/
```

The editor, blocks, device preview, and Export-to-download all work offline.
Open / Save / Publish / Find require the Pages Functions, which `http.server`
doesn't run.

**Full loop (functions + real GitHub):**

```bash
cp .dev.vars.example .dev.vars
# fill in GITHUB_TOKEN and GITHUB_REPO
wrangler pages dev .
# open the URL wrangler prints (usually http://localhost:8788)
```

`.dev.vars` is gitignored.

## Configuration

### Pages Functions env vars

Set under Project → Settings → Environment variables in the Cloudflare Pages
dashboard.

| Key | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | yes | Fine-grained PAT with `contents: read/write` and `pull_requests: read/write` on the target repo |
| `GITHUB_REPO`  | yes | The target repo, e.g. `owner/repo` |
| `PUBLISH_PATH_PATTERN` | no | Path pattern for new pages, with `{slug}` substituted. Defaults to `pages/{slug}/index.html` |
| `ANTHROPIC_API_KEY` | only for AI panel | Auth for `functions/ai/chat.js` |
| `ANTHROPIC_MODEL`   | no | Defaults to `claude-sonnet-4-6` |

### Frontend `<meta>` tags

Edit `index.html` to set:

```html
<meta name="studio-site-origin" content="https://example.com">
<meta name="studio-github-repo" content="owner/repo">
<meta name="studio-features"    content="songs">
```

- `studio-site-origin` — if your deployed site uses site-absolute paths
  (e.g. `<img src="/icon.png">`), set this to the deployed origin so previews
  load assets from there. Empty disables the rewrite.
- `studio-github-repo` — display-only; populates `<code class="repo-name">`
  placeholders in the setup modal so users see your repo name. The functions
  side reads `GITHUB_REPO` independently.
- `studio-features` — comma-separated feature flags. Currently supports
  `songs` (reveals the karaoke-style Songs panel for editing embedded
  `<script id="songs-data">` blocks).

## Deploying

1. Create a new Cloudflare Pages project, connect this repo.
2. Build command: *(none — static)*. Output dir: `/`.
3. Gate the URL with Cloudflare Access or your auth flavor of choice.
4. Add the env bindings above.

## Adding your own blocks

A block is a JS module that exports a `{ id, label, media, content }` object.
Drop it in `blocks/`, import it in `blocks/index.js`, and add it to the
`BLOCKS` array. Class names should use the `bx-` prefix and be styled in
`styles/blocks.css` (which is inlined into the exported HTML, so the same
classes render in the editor and on the published page).

See `blocks/hero-card.js` and `styles/blocks.css` for the smallest working
example.

## Karaoke example pack

`blocks/karaoke/` ships a three-block pack (song hero, lyric row, runner
stub) preserved verbatim from the studio this template was extracted from.
It's a useful reference for building a domain-specific pack with its own
class prefix, sample copy, and CSS file.

To enable it, add to `studio.js` after `registerBlocks(editor)`:

```js
import { registerKaraokeBlocks } from './blocks/karaoke/index.js';
registerKaraokeBlocks(editor);
```

And in `index.html`:

```html
<link rel="stylesheet" href="styles/blocks-karaoke.css">
```

## Caveats

- Inline `<script>` tags survive verbatim through Open → Save but don't run in
  the canvas preview by default. Toggle with the `⚡` topbar button.
- The first save on a hand-crafted page will have a noisy diff (GrapesJS
  re-formats whitespace and consolidates `<style>` blocks). Subsequent saves
  produce clean diffs.
- If someone else edits the file on GitHub between your Open and Save, the
  API returns a SHA conflict and tells you to reload. No silent overwrites.

## License

MIT — see [LICENSE](./LICENSE).
