/**
 * Pagewright bootstrap. Wires up GrapesJS, the topbar, the side panels
 * (layers, find-in-repo, actions), the open/edit/save flows against the
 * configured GitHub repo, and the toast/undo plumbing. No build step;
 * loaded as an ES module.
 */
import { registerBlocks } from './blocks/index.js';

// Configured site origin used to rewrite site-absolute URLs (e.g. "/icon.png")
// in the canvas preview so assets load from the deployed site rather than
// 404ing under the studio's own origin. Set via <meta name="pw-site-origin">.
// Empty string disables the rewrite.
const SITE_ORIGIN = document.querySelector('meta[name="pw-site-origin"]')?.content?.trim() || '';

// Configured GitHub repo (owner/name). Read here only for displaying in setup
// modals and toasts; the source of truth is the GITHUB_REPO env var on the
// Pages Functions side. Set via <meta name="pw-github-repo">.
const REPO_DISPLAY = document.querySelector('meta[name="pw-github-repo"]')?.content?.trim() || '';

const OPEN_STATE_KEY = 'studio-open';
const TOKEN_KEY      = 'studio-gh-token';

// Optional 8-color palette for image quantization on upload. When set, image
// uploads are mapped to these colors so cards read cohesively. Default null
// disables quantization. To enable, set to an array of [r,g,b] triplets.
const IMAGE_PALETTE = null;

const tokensCss = await (await fetch('styles/tokens.css')).text();
const blocksCss = await (await fetch('styles/blocks.css')).text();
const skeleton  = await (await fetch('templates/page-skeleton.html')).text();

// Populate any <code class="repo-name"> placeholders with the configured repo,
// and reveal feature panels listed in <meta name="pw-features" content="…">.
if (REPO_DISPLAY) {
  for (const el of document.querySelectorAll('.repo-name')) el.textContent = REPO_DISPLAY;
}
{
  const feats = (document.querySelector('meta[name="pw-features"]')?.content || '')
    .split(/[,\s]+/).filter(Boolean);
  for (const feat of feats) {
    for (const el of document.querySelectorAll(`[data-feature="${feat}"]`)) el.hidden = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Token storage, browser-only, sent as x-gh-token header                    */
/* -------------------------------------------------------------------------- */

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(v) { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); }

/** Fetch wrapper that attaches the PAT + surfaces NO_GH_TOKEN as a setup prompt. */
async function api(url, init = {}) {
  const headers = new Headers(init.headers || {});
  const t = getToken();
  if (t) headers.set('x-gh-token', t);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    let data = {};
    try { data = await res.clone().json(); } catch {}
    if (data?.error === 'NO_GH_TOKEN') {
      showSetupModal({ reason: 'no-token' });
      throw new Error('Setup required, paste your GitHub token in the setup modal.');
    }
  }
  return res;
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

const toastStack = document.getElementById('toast-stack');

function toast({ title, body, kind = 'info', ttl = 5500 }) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <div class="t-head">
      <div class="t-title"></div>
      <button class="t-close" aria-label="dismiss">×</button>
    </div>
    <div class="t-body"></div>
  `;
  el.querySelector('.t-title').textContent = title || '';
  const bodyEl = el.querySelector('.t-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';
  const dismiss = () => {
    el.classList.add('fading');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.t-close').addEventListener('click', dismiss);
  toastStack.appendChild(el);
  if (ttl) setTimeout(dismiss, ttl);
  return { dismiss };
}

/* -------------------------------------------------------------------------- */
/* GrapesJS init                                                              */
/* -------------------------------------------------------------------------- */

const editor = window.grapesjs.init({
  container: '#gjs',
  height: '100%',
  width: 'auto',
  fromElement: false,
  storageManager: {
    type: 'local',
    autosave: true,
    autoload: true,
    stepsBeforeSave: 1,
    options: { local: { key: 'studio-draft' } },
  },
  // Don't track selection in the undo stack, selection-only entries cause
  // hasUndo() to return true without any real edit, which makes the Undo
  // button look permanently active. Larger stack so a burst of small edits
  // doesn't run out of history.
  undoManager: { trackSelection: false, maximumStackLength: 200 },
  deviceManager: {
    devices: [
      { id: 'desktop', name: 'Desktop', width: '' },
      { id: 'tablet',  name: 'Tablet',  width: '768px', widthMedia: '992px' },
      { id: 'phone',   name: 'Phone',   width: '390px', widthMedia: '520px' },
    ],
  },
  canvas: { styles: ['styles/tokens.css', 'styles/blocks.css'] },
  plugins: ['gjs-preset-webpage', 'grapesjs-plugin-export'],
  pluginsOpts: {
    'gjs-preset-webpage': { blocksBasicOpts: { flexGrid: true } },
    'grapesjs-plugin-export': { addExportBtn: false },
  },
});

registerBlocks(editor);

/* -------------------------------------------------------------------------- */
/* Global toolbar filter                                                       */
/*                                                                             */
/* Pagewright blocks opt out of the default trash button at the registry     */
/* (blocks/index.js BLOCK_TOOLBAR). That only covers the root wrapper          */
/* of a dropped block, its CHILDREN, plus basic-preset blocks the user drops, */
/* plus pasted markup all still inherit GrapesJS's default ↑ ✥ ⧉ 🗑. Filter    */
/* tlb-delete off every component as it joins the tree. Also strip the root    */
/* <body> wrapper's toolbar entirely, nothing to do at that level.            */
/* -------------------------------------------------------------------------- */

try { editor.DomComponents.getWrapper()?.set('toolbar', []); } catch {}

editor.on('component:add', (component) => {
  try {
    const tb = component?.get?.('toolbar');
    if (Array.isArray(tb) && tb.length) {
      const filtered = tb.filter(b => b?.command !== 'tlb-delete');
      if (filtered.length !== tb.length) component.set('toolbar', filtered);
    }
  } catch {}
});

/* Empty-state hint on canvas */
function syncEmptyHint() {
  const el = document.getElementById('empty-hint');
  if (!el) return;
  try {
    const childCount = editor.getWrapper()?.components()?.length ?? 0;
    el.hidden = childCount > 0;
  } catch { /* swallow, hint is purely cosmetic */ }
}
editor.on('component:add component:remove load', syncEmptyHint);
setTimeout(syncEmptyHint, 150);

/* -------------------------------------------------------------------------- */
/* Actions Inspector, detect animations/transitions/event handlers on a page */
/*                                                                             */
/* Each detected "action" gets a stable id and a synthesized CSS override       */
/* that neutralizes it when disabled. On save we write:                         */
/*   1) a <script type="application/json" id="actions-config"> block           */
/*      listing disabled ids + sound bindings,                                  */
/*   2) a tiny runtime <script> that reads the block and stamps                 */
/*      data-actions-disabled="…" on <html>,                                    */
/*   3) override CSS guarded by html[data-actions-disabled~="id"] selectors.    */
/* Round-trip: on Open we parse (1) back into state and mark toggles.           */
/* -------------------------------------------------------------------------- */

const ACTIONS_BLOCK_RE =
  /<script\s+type="application\/json"\s+id="actions-config"\s*>([\s\S]*?)<\/script>/i;
const ACTIONS_RUNTIME_RE =
  /<script[^>]*data-studio-actions-runtime[^>]*>[\s\S]*?<\/script>\s*/i;
const ACTIONS_CSS_RE =
  /<style[^>]*data-studio-actions-css[^>]*>[\s\S]*?<\/style>\s*/i;

/** State for the open file's Actions tab. */
let actionsState = null; // { actions: [...], disabled: Set<string>, dirty: bool }

/**
 * Detect CSS animations/transitions and JS event handlers in a page's raw
 * HTML. Returns a flat array of actions; consumers group by kind for display.
 *
 * Returned shape: {
 *   id: string,            // slug, used in data-actions-disabled
 *   kind: 'css-transition'|'css-animation'|'css-keyframes'|'js-listener'|'html-handler',
 *   selector: string,      // CSS selector or event target descriptor
 *   event?: string,        // click/mouseover/...
 *   property?: string,     // transition property
 *   animationName?: string,
 *   disableCss?: string,   // selector + properties that neutralize the action
 *   title: string,         // human-readable headline
 *   meta: string,          // secondary line
 * }
 */
function detectActions(rawHtml) {
  const actions = [];
  const seen = new Set();
  const pushUnique = (a) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    actions.push(a);
  };

  // ---- CSS: iterate every <style> block, pick out rules of interest --------
  const styleMatches = rawHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const sm of styleMatches) {
    const css = sm[1];
    // 1) @keyframes NAME { ... }
    for (const km of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      const name = km[1];
      pushUnique({
        id: `kf-${slugifyId(name)}`,
        kind: 'css-keyframes',
        animationName: name,
        title: `@keyframes ${name}`,
        meta: 'keyframe definition',
      });
    }
    // 2) Rules with `transition:` or `animation:` (the declaration-level hit
    //    gives us the selector + specific property). Rules look like:
    //      selector { … transition: X Y Z; … }   or animation: …
    //    We split on closing braces and parse each block.
    const blocks = splitRules(css);
    for (const { selector, body } of blocks) {
      if (!selector || !body) continue;
      if (/^@/.test(selector.trim())) continue; // skip @media/@supports wrappers themselves
      const transition = firstDecl(body, 'transition');
      const animation  = firstDecl(body, 'animation');
      if (transition) {
        const sel = selector.trim();
        pushUnique({
          id: `cst-${slugifyId(sel)}`,
          kind: 'css-transition',
          selector: sel,
          property: transition,
          title: transition ? `${sel}` : sel,
          meta: `transition: ${truncate(transition, 60)}`,
          disableCss: `${sel} { transition: none !important; transform: none !important; }`,
        });
      }
      if (animation) {
        const sel = selector.trim();
        const name = (animation.match(/[\w-]+/) || [''])[0];
        pushUnique({
          id: `csa-${slugifyId(sel)}`,
          kind: 'css-animation',
          selector: sel,
          animationName: name,
          title: sel,
          meta: `animation: ${truncate(animation, 60)}`,
          disableCss: `${sel} { animation: none !important; }`,
        });
      }
    }
  }

  // ---- JS: addEventListener(...) calls in <script> bodies ------------------
  const scriptMatches = rawHtml.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi);
  for (const sm of scriptMatches) {
    const src = sm[1];
    const jsHits = detectJsListeners(src);
    for (const hit of jsHits) {
      const id = `js-${slugifyId(hit.event + '-' + hit.selector)}`;
      pushUnique({
        id,
        kind: 'js-listener',
        event: hit.event,
        selector: hit.selector,
        title: `${hit.event} · ${hit.selector}`,
        meta: hit.description || `addEventListener('${hit.event}', …)`,
        runtime: { event: hit.event, selector: hit.selector },
      });
    }
  }

  // ---- HTML on* attributes in the body ------------------------------------
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const body = bodyMatch[1];
    // Capture opening tags with at least one on* attribute; then look up its
    // id / class so the runtime can target it by selector.
    const handlerRe = /<(\w+)([^>]*?)\s(on\w+)=["']([^"']*)["']([^>]*)>/g;
    let m;
    while ((m = handlerRe.exec(body))) {
      const tag      = m[1];
      const attrsBefore = m[2] || '';
      const handler  = m[3];
      const attrsAfter  = m[5] || '';
      const attrs    = attrsBefore + ' ' + attrsAfter;
      const idMatch  = attrs.match(/\bid=["']([\w-]+)["']/);
      const classMatch = attrs.match(/\bclass=["']([^"']+)["']/);
      const selector = idMatch
        ? `#${idMatch[1]}`
        : classMatch ? `${tag}.${classMatch[1].trim().split(/\s+/)[0]}`
                     : tag;
      const event = handler.replace(/^on/, '');
      const id = `html-${slugifyId(handler + '-' + selector)}`;
      pushUnique({
        id,
        kind: 'html-handler',
        event,
        selector,
        title: `${handler} on ${selector}`,
        meta: `inline ${handler} attribute`,
        runtime: { event, selector },
      });
    }
  }

  return actions;
}

/**
 * Resolve every `addEventListener` call in a <script> body to a best-effort
 * { event, selector } pair. Handles the common patterns:
 *   • const X = document.getElementById('id');  X.addEventListener('click', …)
 *   • const X = document.querySelector('sel');  X.addEventListener(…)
 *   • document.getElementById('id').addEventListener(…)
 *   • document.querySelector('sel').addEventListener(…)
 *   • document.querySelectorAll('sel').forEach(k => k.addEventListener(…))
 *   • document.querySelectorAll('sel').forEach(function(k){ k.addEventListener(…) })
 * Skips listeners on document/window (can't be targeted by selector) and any
 * call whose target we can't resolve.
 */
function detectJsListeners(src) {
  const out = [];
  const seen = new Set();

  // Build a var → selector map from `const/let/var X = document.getElementById('id')`
  // and `= document.querySelector('sel')`. Kept simple: first binding wins.
  const varDefs = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*document\.getElementById\s*\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    if (!(m[1] in varDefs)) varDefs[m[1]] = '#' + m[2];
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*document\.querySelector\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
    if (!(m[1] in varDefs)) varDefs[m[1]] = m[2];
  }

  const push = (event, selector, description) => {
    const key = event + '|' + selector;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ event, selector, description });
  };

  // document.querySelectorAll('SEL').forEach(X => X.addEventListener('EVENT', …))
  //  , arrow form
  for (const m of src.matchAll(/document\.querySelectorAll\s*\(\s*['"]([^'"\n]+)['"]\s*\)\s*\.forEach\s*\(\s*\(?(\w+)\)?\s*=>\s*[\s\S]{0,40}?\2\.addEventListener\s*\(\s*['"]([\w-]+)['"]/g)) {
    push(m[3], m[1], `forEach(${m[2]} => …addEventListener)`);
  }
  // document.querySelectorAll(…).forEach(function(X){ X.addEventListener(…) })
  for (const m of src.matchAll(/document\.querySelectorAll\s*\(\s*['"]([^'"\n]+)['"]\s*\)\s*\.forEach\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*\{[\s\S]{0,200}?\2\.addEventListener\s*\(\s*['"]([\w-]+)['"]/g)) {
    push(m[3], m[1], `forEach(function(${m[2]}){…addEventListener})`);
  }

  // document.getElementById('id').addEventListener('event', …)
  for (const m of src.matchAll(/document\.getElementById\s*\(\s*['"]([\w-]+)['"]\s*\)\.addEventListener\s*\(\s*['"]([\w-]+)['"]/g)) {
    push(m[2], '#' + m[1], 'getElementById(…).addEventListener');
  }
  // document.querySelector('sel').addEventListener('event', …)
  for (const m of src.matchAll(/document\.querySelector\s*\(\s*['"]([^'"\n]+)['"]\s*\)\.addEventListener\s*\(\s*['"]([\w-]+)['"]/g)) {
    push(m[2], m[1], 'querySelector(…).addEventListener');
  }

  // Simple: <var>.addEventListener('event', …), if we know the var.
  for (const m of src.matchAll(/(?:^|[^.\w$])(\w+)\.addEventListener\s*\(\s*['"]([\w-]+)['"]/g)) {
    const target = m[1];
    const event  = m[2];
    if (target === 'document' || target === 'window') continue;
    const sel = varDefs[target];
    if (sel) push(event, sel, `${target}.addEventListener (resolved from ${sel})`);
  }

  return out;
}

/** Return individual `selector { body }` blocks from a CSS string, honoring
 *  basic nesting for @media/@supports. Selectors inside those wrappers are
 *  surfaced too. Not a full CSS parser, good enough for rule-level scans. */
function splitRules(css) {
  const out = [];
  let i = 0, depth = 0;
  let currentSelector = '';
  let start = 0;
  const atStack = [];
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const sel = css.slice(start, i).trim();
      if (/^@(media|supports|keyframes|container|layer)\b/.test(sel)) {
        atStack.push(sel);
      } else if (sel) {
        // Collect body until matching close at same depth.
        let j = i + 1, bodyDepth = 1, bodyStart = j;
        while (j < css.length && bodyDepth > 0) {
          if (css[j] === '{') bodyDepth++;
          else if (css[j] === '}') bodyDepth--;
          if (bodyDepth === 0) break;
          j++;
        }
        out.push({ selector: sel, body: css.slice(bodyStart, j) });
        i = j;
      }
      depth++;
      i++;
      start = i;
      continue;
    }
    if (c === '}') {
      if (atStack.length) atStack.pop();
      depth--;
      i++;
      start = i;
      continue;
    }
    i++;
  }
  return out;
}

function firstDecl(body, prop) {
  // Exact property match, not shorthand collisions. E.g. `transition:` but
  // not `-webkit-transition:` (covered by a second regex if needed).
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function slugifyId(s) {
  return String(s)
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* Parse / serialize the actions-config JSON block round-trip. */
function parseActionsConfig(raw) {
  const m = raw.match(ACTIONS_BLOCK_RE);
  if (!m) return { disabled: [], sounds: [], triggers: {} };
  try {
    const cfg = JSON.parse(m[1].trim());
    return {
      disabled: Array.isArray(cfg?.disabled) ? cfg.disabled : [],
      sounds:   Array.isArray(cfg?.sounds)   ? cfg.sounds   : [],
      triggers: (cfg?.triggers && typeof cfg.triggers === 'object') ? cfg.triggers : {},
    };
  } catch { return { disabled: [], sounds: [], triggers: {} }; }
}

function serializeActionsConfig(state) {
  // Build the runtime-only view: only triggers (JS + inline handlers) need
  // to ride along so the IIFE can intercept them. CSS actions don't, their
  // overrides live as guarded CSS rules under data-actions-disabled attrs.
  const triggers = {};
  for (const a of (state.actions || [])) {
    if (a.runtime) triggers[a.id] = a.runtime; // { event, selector }
  }
  // Whitelist fields per sound. `_preview` holds a multi-MB base64 dataURL
  // used only for the in-studio ▸ preview button; it must never ship in the
  // saved HTML.
  const sounds = (state.sounds || []).map(s => ({ id: s.id, src: s.src }));
  const cfg = {
    disabled: [...state.disabled],
    triggers,
    sounds,
  };
  return `<script type="application/json" id="actions-config">\n${JSON.stringify(cfg, null, 2)}\n</script>`;
}

/** Generate the runtime hook script. Reads the actions-config block, then:
 *   1) stamps data-actions-disabled="…" on <html> (drives CSS overrides)
 *   2) installs one capture-phase document listener per distinct event used
 *      in triggers, which:
 *        - stopImmediatePropagation's when the matching trigger is disabled
 *        - plays the bound sound when the matching trigger has one
 */
function actionsRuntimeScript() {
  return `<script data-studio-actions-runtime="1">
(function(){
  var el = document.getElementById('actions-config');
  if (!el) return;
  var cfg;
  try { cfg = JSON.parse(el.textContent); } catch(e) { return; }

  var disabledList = Array.isArray(cfg.disabled) ? cfg.disabled : [];
  var disabled = Object.create(null);
  for (var i = 0; i < disabledList.length; i++) disabled[disabledList[i]] = 1;
  if (disabledList.length) {
    document.documentElement.setAttribute('data-actions-disabled', disabledList.join(' '));
  }

  var triggers = (cfg && typeof cfg.triggers === 'object') ? cfg.triggers : {};
  var soundsById = Object.create(null);
  if (Array.isArray(cfg.sounds)) {
    for (var j = 0; j < cfg.sounds.length; j++) {
      var s = cfg.sounds[j];
      if (s && s.id && s.src) soundsById[s.id] = s.src;
    }
  }

  // Preload audio so first trigger plays without a fetch hiccup.
  var audioPool = Object.create(null);
  Object.keys(soundsById).forEach(function(id){
    var a = new Audio(soundsById[id]);
    a.preload = 'auto';
    audioPool[id] = a;
  });

  // Group triggers by event, so we install at most one capture-phase listener
  // per event type on <document>.
  var byEvent = Object.create(null);
  Object.keys(triggers).forEach(function(id){
    var t = triggers[id];
    if (!t || !t.event || !t.selector) return;
    (byEvent[t.event] = byEvent[t.event] || []).push({ id: id, selector: t.selector });
  });

  Object.keys(byEvent).forEach(function(event){
    document.addEventListener(event, function(ev){
      var list = byEvent[event];
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var matches = false;
        try { matches = ev.target && (ev.target.matches(t.selector) || ev.target.closest(t.selector)); }
        catch (_) {}
        if (!matches) continue;
        if (disabled[t.id]) {
          ev.stopImmediatePropagation();
          // Don't preventDefault, keep native behavior (link navigation etc.)
          return;
        }
        if (audioPool[t.id]) {
          try {
            var src = audioPool[t.id];
            // Clone so overlapping triggers don't cut each other off.
            var a = src.cloneNode();
            a.play().catch(function(){});
          } catch (_) {}
        }
      }
    }, true);
  });
})();
</script>`;
}

/** Produce the override CSS block that neutralizes every disabled action. */
function actionsOverrideCss(actions, disabledIds) {
  const rules = [];
  for (const a of actions) {
    if (!disabledIds.includes(a.id) || !a.disableCss) continue;
    // Guard each rule by the html[data-actions-disabled~="id"] ancestor so it
    // only fires on the saved page when the config enables it.
    const guarded = a.disableCss.replace(/^(\s*)([^{]+)\{/, (_, pre, sel) =>
      `${pre}html[data-actions-disabled~="${a.id}"] ${sel.trim()} {`
    );
    rules.push(guarded);
  }
  if (!rules.length) return '';
  return `<style data-studio-actions-css="1">\n/* actions inspector, disables, written by studio */\n${rules.join('\n')}\n</style>`;
}

/* -------------------------------------------------------------------------- */
/* Songs data, parsed from <script type="application/json" id="songs-data">  */
/* -------------------------------------------------------------------------- */

/**
 * Songs state for the currently-open file:
 *   { songs: Array, dirty: bool, pendingAssets: Array<{path, base64, dataUrl}> }
 * Null when the open page has no songs-data block (or nothing open).
 */
let songsState = null;

const SONGS_BLOCK_RE =
  /<script\s+type="application\/json"\s+id="songs-data"\s*>([\s\S]*?)<\/script>/i;

function parseSongsBlock(raw) {
  const m = raw.match(SONGS_BLOCK_RE);
  if (!m) return null;
  try {
    const songs = JSON.parse(m[1].trim());
    if (!Array.isArray(songs)) return null;
    return songs;
  } catch { return null; }
}

function serializeSongsBlock(songs) {
  const body = JSON.stringify(songs, null, 2);
  return `<script type="application/json" id="songs-data">\n${body}\n</script>`;
}

function replaceSongsBlock(raw, songs) {
  return raw.replace(SONGS_BLOCK_RE, serializeSongsBlock(songs));
}

/** Write (or strip) the actions-config block, runtime hook, and override CSS
 *  into raw HTML based on the current state. Stateless: safely round-trips
 *  repeatedly, previous studio-injected markers are stripped first. */
function bakeActionsIntoHtml(raw, state) {
  // Always clean previous studio injections before deciding whether to add back.
  let out = raw
    .replace(ACTIONS_BLOCK_RE, '')
    .replace(ACTIONS_RUNTIME_RE, '')
    .replace(ACTIONS_CSS_RE, '');

  const hasDisabled = state.disabled?.size > 0;
  const hasSounds   = (state.sounds || []).length > 0;
  if (!hasDisabled && !hasSounds) return out;

  const disabledArr = [...state.disabled];
  const config = serializeActionsConfig({ disabled: disabledArr, sounds: state.sounds || [] });
  const runtime = actionsRuntimeScript();
  const css = actionsOverrideCss(state.actions, disabledArr);

  // Inject config + runtime at the top of <head>, override CSS at the end of
  // <head>. Keeps them in one canonical location regardless of the page's
  // other head contents.
  const headOpen = out.search(/<head[^>]*>/i);
  if (headOpen < 0) return out; // malformed doc, bail
  const headTagEnd = out.indexOf('>', headOpen) + 1;
  out = out.slice(0, headTagEnd) + '\n' + config + '\n' + runtime + '\n' + out.slice(headTagEnd);

  if (css) {
    out = out.replace(/<\/head>/i, css + '\n</head>');
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Mode state (new vs. edit)                                                  */
/* -------------------------------------------------------------------------- */

let currentOpen = null;

function setOpen(state) {
  currentOpen = state;
  if (state) {
    localStorage.setItem(OPEN_STATE_KEY, JSON.stringify({ path: state.path, sha: state.sha }));
  } else {
    localStorage.removeItem(OPEN_STATE_KEY);
  }
  renderMode();
}

function renderMode() {
  const label      = document.getElementById('mode-label');
  const slugInput  = document.getElementById('song-slug');
  const btnSave    = document.getElementById('btn-save');
  const btnPublish = document.getElementById('btn-publish');
  if (currentOpen) {
    label.textContent = `editing ${currentOpen.path}`;
    label.classList.add('editing');
    slugInput.style.display = 'none';
    btnSave.style.display = '';
    btnPublish.style.display = 'none';
  } else {
    label.textContent = 'new page';
    label.classList.remove('editing');
    slugInput.style.display = '';
    btnSave.style.display = 'none';
    btnPublish.style.display = '';
  }
}

/* -------------------------------------------------------------------------- */
/* URL rewriting, site-absolute <-> full origin                              */
/*                                                                             */
/* If the deployed site uses site-absolute paths like "/icon-192.png" in      */
/* HTML attrs (src/href/poster) or CSS url(...) refs, those 404 under the     */
/* studio origin during preview. When SITE_ORIGIN is configured we rewrite    */
/* them to absolute URLs on load and reverse on save so the committed HTML    */
/* stays neutral. When SITE_ORIGIN is empty the rewrite is a no-op.           */
/* -------------------------------------------------------------------------- */

const ORIGIN_ESC = SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function absolutizeUrls(text) {
  if (!SITE_ORIGIN) return text;
  return text
    .replace(/(src|href|poster)="\/(?!\/)/g, `$1="${SITE_ORIGIN}/`)
    .replace(/(src|href|poster)='\/(?!\/)/g, `$1='${SITE_ORIGIN}/`)
    .replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${SITE_ORIGIN}/`);
}

function relativizeUrls(text) {
  if (!SITE_ORIGIN) return text;
  return text
    .replace(new RegExp(`(src|href|poster)="${ORIGIN_ESC}/`, 'g'), '$1="/')
    .replace(new RegExp(`(src|href|poster)='${ORIGIN_ESC}/`, 'g'), "$1='/")
    .replace(new RegExp(`url\\(\\s*(['"]?)${ORIGIN_ESC}/`, 'g'), 'url($1/');
}

/* -------------------------------------------------------------------------- */
/* Parse + reassemble existing page HTML                                      */
/* -------------------------------------------------------------------------- */

function parseExistingHtml(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  // Capture <html> attributes (e.g. data-theme="light"), these drive the
  // page's default palette and flag which variant of any `:root[data-…]`
  // selector activates.
  const htmlAttrs = {};
  for (const a of doc.documentElement.attributes) htmlAttrs[a.name] = a.value;

  // All inline <style> blocks. Kept as a single string and later injected
  // verbatim into the canvas iframe, do NOT pipe through GrapesJS setStyle,
  // it silently drops @font-face / @keyframes / :root vars / pseudo-elements.
  const styleNodes = Array.from(doc.querySelectorAll('style'));
  const cssText = absolutizeUrls(styleNodes.map(s => s.textContent).join('\n\n'));

  // Head-level <link>s that matter for rendering: preconnects + stylesheets
  // (mainly Google Fonts). Without these, every custom font falls back.
  const headLinks = Array.from(
    doc.head.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]')
  ).map(l => l.outerHTML);

  // Extract all <script> tags in source order. GrapesJS sets the iframe body
  // via innerHTML, which means any <script> tags in bodyHtml are inert DOM.
  // We'll re-inject these via createElement+appendChild so they actually run
  // in the preview, that's how JS-rendered regions (album tiles on the
  // landing page, timestamp table on tap-lines, etc.) populate. The original
  // scripts still pass through bodyHtml to the component tree, so Save
  // preserves them in the committed HTML.
  const scripts = Array.from(doc.querySelectorAll('script')).map(s => ({
    src:   s.getAttribute('src'),
    type:  s.getAttribute('type'),
    async: s.hasAttribute('async'),
    defer: s.hasAttribute('defer'),
    text:  s.textContent,
  }));

  const bodyHtml = absolutizeUrls(doc.body.innerHTML);
  return { bodyHtml, cssText, htmlAttrs, headLinks, scripts };
}

/** Apply page chrome to the GrapesJS canvas iframe so the preview
 *  matches the real site: original CSS, fonts, <html> theme attrs, live
 *  JS execution for tile/population scripts, plus a small set of editor-only
 *  overrides (scroll, fixed overlays).
 *
 *  Wrapped in UndoManager stop/start/clear so none of the iframe setup (style
 *  injection, font link rewiring, script execution, <html> attr writes) can
 *  land in the undo stack. Clear() on the way out drops any churn that still
 *  made it in, first real user edit starts with a clean slate. */
function applyCanvasDocTweaks({ cssText, htmlAttrs, headLinks, scripts }) {
  const doc = editor.Canvas?.getDocument?.();
  if (!doc) return false;
  const um = editor.UndoManager;
  um?.stop?.();
  try { return applyCanvasDocTweaksInner(doc, { cssText, htmlAttrs, headLinks, scripts }); }
  finally {
    um?.start?.();
    // Drop anything that may have slipped into the stack during init so the
    // first real edit doesn't "undo into" the page-load state.
    requestAnimationFrame(() => { try { um?.clear?.(); refreshUndoButtons?.(); } catch {} });
  }
}

function applyCanvasDocTweaksInner(doc, { cssText, htmlAttrs, headLinks, scripts }) {

  // Clear anything we injected on a previous Open.
  doc.querySelectorAll('[data-studio-inject]').forEach(el => el.remove());

  // Propagate <html> attributes to the iframe root.
  for (const [k, v] of Object.entries(htmlAttrs)) {
    try { doc.documentElement.setAttribute(k, v); } catch {}
  }

  // Inject font / preconnect <link>s into the iframe head.
  for (const html of headLinks) {
    const tmp = doc.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    if (!el) continue;
    el.setAttribute('data-studio-inject', 'link');
    doc.head.appendChild(el);
  }

  // Inject the original CSS verbatim. GrapesJS never sees it; rendering is
  // exact. (On save we reassemble from the originalHtml, so this is purely
  // a preview concern.)
  const style = doc.createElement('style');
  style.setAttribute('data-studio-inject', 'css');
  style.textContent = cssText;
  doc.head.appendChild(style);

  // Editor-only overrides. Pages that lock the viewport
  // (html,body{height:100%;overflow:hidden}) for an app-shell feel are awful
  // in an editor. Re-enable scroll, knock fixed overlays out of the tap-layer
  // so elements stay selectable, and use 100vh for min-height (100% against an
  // auto-height html can collapse under Safari, shortening the body and
  // cropping top padding).
  const override = doc.createElement('style');
  override.setAttribute('data-studio-inject', 'override');
  override.textContent = `
    html, body { overflow: visible !important; height: auto !important; min-height: 100vh !important; }
    body::before, body::after { position: absolute !important; z-index: 0 !important; pointer-events: none !important; }
    /* Selection + hover outlines, replace GrapesJS's low-contrast default
       blue with the studio accent so they read on the dark canvas chrome.
       Literal hex (not var()) because this is injected into the iframe. */
    .gjs-selected { outline: 2px solid #c4b5fd !important; outline-offset: 1px !important; }
    .gjs-selected-parent { outline: 1px dashed #8b7dcf !important; }
    .gjs-hovered { outline: 1px solid rgba(196,181,253,.55) !important; }
    .gjs-comp-selected-toolbar { background: #1a1a2e !important; border: 1px solid #8b7dcf !important; }
    .gjs-toolbar-item { color: #e2e2e8 !important; }
  `;
  doc.head.appendChild(override);

  // Run the page's scripts so JS-driven regions populate. Wait a frame to
  // make sure the iframe body innerHTML assignment from setComponents has
  // settled, then inject each script via createElement+appendChild so the
  // browser actually executes it.
  if (scripts?.length && !scriptsDisabled()) {
    requestAnimationFrame(() => runPageScripts(doc, scripts));
  }

  // GrapesJS and any page scripts that populate hero regions both trigger
  // reflows that can leave the iframe scrolled past empty top-padding,
  // clipping the header. A one-shot scrollTo loses to whichever autoscroll
  // fires last; instead, pin the iframe to scrollTop=0 until the user
  // actually interacts with the canvas.
  pinCanvasScrollUntilUserActs(doc);
  return true;
}

/** Keep the iframe scrolled to top through the initial paint / script / font-
 *  load / image-decode storm. Auto-releases on first real user interaction
 *  (pointerdown / wheel / keydown / touchstart) or after a 4s hard timeout.
 *
 *  Three defenses vs. the three ways the previous rAF-only pin leaked:
 *    1. ResizeObserver on <body> re-snaps whenever layout shifts (font swap,
 *       late SONGS.forEach rack injection, image decode), deterministic,
 *       no idle-rAF battery drain.
 *    2. document.fonts 'loadingdone' re-snaps when Google Fonts finish on
 *       cold caches (which routinely exceeds 2.5s).
 *    3. editor.Canvas.scrollTo is temporarily shadowed so GrapesJS's own
 *       "scroll selected into view" during hover/select can't scroll past
 *       our page top during the pin window.
 *  All three defenses are torn down in release() so we don't leak observers
 *  or leave scrollTo patched after the user has taken over. */
const DEFAULT_SCROLL_PIN_MS = 4000;
function pinCanvasScrollUntilUserActs(doc) {
  const win = doc.defaultView;
  if (!win) return;
  let released = false;
  const snap = () => { if (!released && win.scrollY > 0) try { win.scrollTo(0, 0); } catch {} };

  // Temporarily neutralize GrapesJS's own autoscroll so hover/select during
  // the pin window can't move the viewport past the page top.
  const canvas = editor.Canvas;
  const origScrollTo = canvas && typeof canvas.scrollTo === 'function' ? canvas.scrollTo.bind(canvas) : null;
  if (origScrollTo) { canvas.scrollTo = () => {}; }

  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(snap) : null;
  try { ro?.observe(doc.body); } catch {}
  const onFonts = () => snap();
  try { doc.fonts?.addEventListener?.('loadingdone', onFonts); } catch {}

  const release = () => {
    if (released) return;
    released = true;
    ['pointerdown','wheel','keydown','touchstart'].forEach(evt =>
      win.removeEventListener(evt, release, true)
    );
    try { ro?.disconnect(); } catch {}
    try { doc.fonts?.removeEventListener?.('loadingdone', onFonts); } catch {}
    if (origScrollTo) { canvas.scrollTo = origScrollTo; }
  };
  ['pointerdown','wheel','keydown','touchstart'].forEach(evt =>
    win.addEventListener(evt, release, { capture: true, passive: true })
  );
  setTimeout(release, DEFAULT_SCROLL_PIN_MS);
  snap();
}

const SCRIPTS_DISABLED_KEY = 'studio-scripts-off';
function scriptsDisabled() { return localStorage.getItem(SCRIPTS_DISABLED_KEY) === '1'; }
function setScriptsDisabled(v) {
  if (v) localStorage.setItem(SCRIPTS_DISABLED_KEY, '1');
  else localStorage.removeItem(SCRIPTS_DISABLED_KEY);
  renderScriptToggle();
}

function runPageScripts(doc, scripts) {
  for (const s of scripts) {
    const el = doc.createElement('script');
    el.setAttribute('data-studio-inject', 'script');
    if (s.type)  el.type = s.type;
    if (s.async) el.async = true;
    if (s.defer) el.defer = true;
    if (s.src) {
      // Rewrite site-absolute script srcs so they resolve against SITE_ORIGIN
      // instead of the studio origin (when SITE_ORIGIN is configured).
      let src = s.src;
      if (SITE_ORIGIN && src.startsWith('/') && !src.startsWith('//')) src = SITE_ORIGIN + src;
      el.src = src;
    } else {
      // Use textContent, not innerHTML, avoids any HTML interpretation
      // of the script body.
      el.text = s.text;
    }
    doc.body.appendChild(el);
  }
  // Some scripts attach init on DOMContentLoaded / load. By the time we
  // inject, those events have already fired, so hand-dispatch them once
  // more. Scripts that only listen via addEventListener see them; scripts
  // that ran synchronously at top level already did their work.
  try {
    doc.dispatchEvent(new Event('DOMContentLoaded'));
    doc.defaultView?.dispatchEvent(new Event('load'));
  } catch {}
}

function reassembleHtml(originalRaw) {
  const doc = new DOMParser().parseFromString(originalRaw, 'text/html');

  // Collect original CSS and strip the old <style> blocks. Append any CSS
  // GrapesJS emitted (new inline styles, new classes) at the end so user
  // edits save too, but nothing original is lost. Pagewright-managed markers
  // (data-studio-actions-css) are preserved AS-IS so the next save can
  // cleanly strip + regenerate them via bakeActionsIntoHtml instead of
  // silently duplicating the override rules on every re-save.
  const originalStyles = Array.from(doc.querySelectorAll('style:not([data-studio-actions-css])'));
  const originalCss = originalStyles.map(s => s.textContent).join('\n\n');
  originalStyles.forEach(s => s.remove());

  const grapesCss = (editor.getCss() || '').trim();
  const combined = grapesCss
    ? `${originalCss}\n\n/* --- studio additions --- */\n${grapesCss}`
    : originalCss;

  const style = doc.createElement('style');
  style.textContent = relativizeUrls(combined);
  doc.head.appendChild(style);

  doc.body.innerHTML = relativizeUrls(editor.getHtml());
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

/* -------------------------------------------------------------------------- */
/* New-page export                                                            */
/* -------------------------------------------------------------------------- */

function buildNewPageHtml() {
  const html = editor.getHtml();
  const css  = editor.getCss();
  const slug = document.getElementById('song-slug').value.trim() || 'new-song';
  const title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return skeleton
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{DESCRIPTION}}', title)
    .replaceAll('{{TOKENS_CSS}}', tokensCss)
    .replaceAll('{{BLOCKS_CSS}}', blocksCss + '\n' + css)
    .replaceAll('{{BODY_HTML}}', html);
}

function download(filename, content) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* -------------------------------------------------------------------------- */
/* Setup / help modal                                                         */
/* -------------------------------------------------------------------------- */

const setupModal = document.getElementById('setup-modal');
const setupInput = document.getElementById('setup-token-input');
const setupStatus = document.getElementById('setup-status');

function showSetupModal({ reason } = {}) {
  if (setupModal.open) return;
  setupStatus.hidden = true;
  setupInput.value = getToken() ? '•'.repeat(12) : '';
  setupModal.showModal();
  if (reason === 'no-token') {
    flashStatus('Paste a GitHub PAT below to continue.', 'err');
  }
}

function flashStatus(text, kind = 'ok') {
  setupStatus.hidden = false;
  setupStatus.textContent = text;
  setupStatus.classList.remove('ok', 'err');
  setupStatus.classList.add(kind);
}

document.getElementById('setup-save-btn').addEventListener('click', () => {
  const v = setupInput.value.trim();
  if (!v || v.startsWith('•')) {
    flashStatus('Enter a token starting with github_pat_ or ghp_.', 'err');
    return;
  }
  setToken(v);
  setupInput.value = '•'.repeat(12);
  flashStatus('Token saved to your browser. Try the Test button or close this.', 'ok');
  toast({ title: 'Token saved', body: 'Stored in this browser only.', kind: 'success' });
});

document.getElementById('setup-clear-btn').addEventListener('click', () => {
  setToken('');
  setupInput.value = '';
  flashStatus('Cleared. Paste a new token to continue.', 'err');
});

document.getElementById('setup-test-btn').addEventListener('click', async () => {
  flashStatus('Testing…', 'ok');
  try {
    const res = await api('/repo/tree?pattern=.html');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    flashStatus(`Connected. Found ${data.files.length} HTML files in the repo.`, 'ok');
  } catch (err) {
    flashStatus(`Failed: ${err.message}`, 'err');
  }
});

document.querySelector('#setup-modal .setup-close').addEventListener('click', () => setupModal.close());
setupModal.addEventListener('click', (e) => { if (e.target === setupModal) setupModal.close(); });
document.getElementById('btn-help').addEventListener('click', () => showSetupModal({ reason: 'manual' }));

/* -------------------------------------------------------------------------- */
/* Open modal                                                                 */
/* -------------------------------------------------------------------------- */

// Top-level dirs to surface first in the Open modal. Anything not listed
// falls through to alphabetical. Override at fork time to match your repo.
const GROUP_ORDER = ['pages'];
const openModal  = document.getElementById('open-modal');
const openList   = openModal.querySelector('.open-list');
const openFilter = openModal.querySelector('.open-filter');
let cachedFiles  = null;

async function showOpenModal() {
  if (!getToken()) {
    showSetupModal({ reason: 'no-token' });
    return;
  }
  openModal.showModal();
  if (!cachedFiles) {
    openList.innerHTML = '<div class="empty">loading repo…</div>';
    try {
      const res = await api('/repo/tree?pattern=.html');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      cachedFiles = data.files.filter(f => f.path.endsWith('.html'));
    } catch (err) {
      openList.innerHTML = `<div class="empty">error: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }
  renderFileList('');
}

function renderFileList(filterText) {
  const f = filterText.trim().toLowerCase();
  const files = cachedFiles.filter(x => !f || x.path.toLowerCase().includes(f));
  if (!files.length) {
    openList.innerHTML = '<div class="empty">no matches</div>';
    return;
  }
  const groups = {};
  for (const file of files) {
    const top = file.path.includes('/') ? file.path.split('/')[0] : '(root)';
    (groups[top] ||= []).push(file);
  }
  const keys = Object.keys(groups).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a), bi = GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  let html = '';
  for (const k of keys) {
    html += `<div class="open-group-head">${escapeHtml(k)}</div>`;
    for (const file of groups[k]) {
      const kb = Math.max(1, Math.round(file.size / 1024));
      html += `<div class="open-row" data-path="${escapeAttr(file.path)}" data-sha="${escapeAttr(file.sha)}">
        <span class="open-path">${escapeHtml(file.path)}</span>
        <span class="open-size">${kb} kb</span>
      </div>`;
    }
  }
  openList.innerHTML = html;
  openList.querySelectorAll('.open-row').forEach(el => {
    el.addEventListener('click', () => loadFromRepo(el.dataset.path, el.dataset.sha));
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/["&<>]/g, c => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

openFilter.addEventListener('input', () => renderFileList(openFilter.value));
openModal.querySelector('.open-close').addEventListener('click', () => openModal.close());
openModal.addEventListener('click', (e) => { if (e.target === openModal) openModal.close(); });

async function loadFromRepo(path, listSha) {
  openList.innerHTML = `<div class="empty">loading ${escapeHtml(path)}…</div>`;
  try {
    const res = await api(`/repo/read?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const parsed = parseExistingHtml(data.content);

    editor.setComponents(parsed.bodyHtml);
    // Intentionally skip editor.setStyle, see parseExistingHtml rationale.

    const ok = applyCanvasDocTweaks(parsed);
    if (!ok) editor.once('load', () => applyCanvasDocTweaks(parsed));

    setOpen({ path, sha: data.sha, originalHtml: data.content });

    // Initialize Songs panel state if the file has a songs-data block.
    const songs = parseSongsBlock(data.content);
    if (songs) {
      songsState = { songs, dirty: false, pendingAssets: [] };
      renderSongsPanel();
      switchPanelTab('songs');
    } else {
      songsState = null;
      renderSongsPanel();
      // No songs? The Layers tree is the most useful default, gives
      // immediate spatial orientation in whatever page was opened.
      switchPanelTab('layers');
    }

    // Actions Inspector: detect animations/handlers, pick up any existing
    // disabled/sounds config, apply overrides to the live preview.
    const detected = detectActions(data.content);
    const cfg = parseActionsConfig(data.content);
    actionsState = {
      actions: detected,
      disabled: new Set(cfg.disabled),
      sounds: cfg.sounds || [],
      pendingAudio: [],
      dirty: false,
    };
    renderActionsPanel();
    applyActionsOverridesToCanvas();

    openModal.close();
    toast({ title: 'Loaded', body: `Editing <code>${escapeHtml(path)}</code>`, kind: 'success' });
  } catch (err) {
    openList.innerHTML = `<div class="empty">load failed: ${escapeHtml(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------------------- */
/* Save + publish                                                             */
/* -------------------------------------------------------------------------- */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

async function saveEdit() {
  if (!currentOpen) return;
  if (!getToken()) { showSetupModal({ reason: 'no-token' }); return; }
  const btn = document.getElementById('btn-save');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    // Apply side-panel edits to the raw HTML before we hand it to reassembleHtml.
    let baseHtml = currentOpen.originalHtml;
    if (songsState?.dirty) {
      baseHtml = replaceSongsBlock(baseHtml, songsState.songs);
    }
    if (actionsState) {
      baseHtml = bakeActionsIntoHtml(baseHtml, actionsState);
    }
    const html = reassembleHtml(baseHtml);

    const assets = [
      ...(songsState?.pendingAssets || []),
      ...(actionsState?.pendingAudio || []),
    ].map(a => ({ path: a.path, base64: a.base64 }));

    const res = await api('/publish/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'edit',
        path: currentOpen.path,
        html,
        assets,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      currentOpen.originalHtml = baseHtml;
      setOpen(currentOpen);
      if (songsState) { songsState.dirty = false; songsState.pendingAssets = []; renderSongsPanel(); }
      if (actionsState) {
        actionsState.dirty = false;
        actionsState.pendingAudio = [];
        // After save, _preview dataUrls aren't needed, drop them.
        if (actionsState.sounds) {
          actionsState.sounds = actionsState.sounds.map(s => { const { _preview, ...rest } = s; return rest; });
        }
        renderActionsPanel();
      }
      toast({
        title: 'Saved',
        body: `<a href="${data.pr_url}" target="_blank" rel="noopener">Open PR ↗</a>${
          data.assets?.length ? ` · ${data.assets.length} asset${data.assets.length > 1 ? 's' : ''} uploaded` : ''
        }`,
        kind: 'success', ttl: 9000,
      });
    } else {
      toast({ title: 'Save failed', body: escapeHtml(data.error || 'unknown'), kind: 'error', ttl: 9000 });
    }
  } catch (err) {
    toast({ title: 'Save error', body: escapeHtml(err.message), kind: 'error', ttl: 9000 });
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

async function publishNewPage() {
  const slug = document.getElementById('song-slug').value.trim();
  if (!SLUG_RE.test(slug)) {
    toast({ title: 'Invalid slug', body: 'Use lowercase letters, numbers, and hyphens (2–60 chars).', kind: 'error' });
    return;
  }
  if (!getToken()) { showSetupModal({ reason: 'no-token' }); return; }
  const btn = document.getElementById('btn-publish');
  btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const res = await api('/publish/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'create', slug, html: buildNewPageHtml() }),
    });
    const data = await res.json();
    if (data.ok) {
      toast({ title: 'Published', body: `<a href="${data.pr_url}" target="_blank" rel="noopener">Open PR ↗</a>`, kind: 'success', ttl: 9000 });
    } else {
      toast({ title: 'Publish failed', body: escapeHtml(data.error || 'unknown'), kind: 'error', ttl: 9000 });
    }
  } catch (err) {
    toast({ title: 'Publish error', body: escapeHtml(err.message), kind: 'error', ttl: 9000 });
  } finally {
    btn.disabled = false; btn.textContent = 'Publish';
  }
}

function startNewPage() {
  if (currentOpen && !confirm('Discard edits and start a blank new page?')) return;
  editor.setComponents('');
  editor.setStyle('');
  setOpen(null);
  syncEmptyHint();
}

/* -------------------------------------------------------------------------- */
/* Topbar wiring                                                              */
/* -------------------------------------------------------------------------- */

document.getElementById('btn-new').addEventListener('click', startNewPage);
document.getElementById('btn-open').addEventListener('click', showOpenModal);
document.getElementById('btn-save').addEventListener('click', saveEdit);
document.getElementById('btn-publish').addEventListener('click', publishNewPage);

/* -------------------------------------------------------------------------- */
/* Viewport controls, back-to-top, fit, 100% + keyboard shortcuts            */
/*                                                                             */
/* Canvas selection in GrapesJS scrolls + highlights the selected component,  */
/* so after exploring a nested element it's easy to lose track of "the whole  */
/* page." The ↖ / ⤢ / 100% buttons always get you back to a known state:      */
/*   ↖   scroll iframe to 0,0 AND deselect any active component (also: Esc)   */
/*   ⤢   fit the iframe content into the visible canvas (⌘1)                  */
/*   100%  reset zoom to 1:1 (⌘0)                                              */
/* -------------------------------------------------------------------------- */

function canvasScrollToTop() {
  const doc = editor.Canvas?.getDocument?.();
  try { doc?.defaultView?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); } catch {}
  try { editor.select(null); } catch {}
}
function canvasResetZoom() {
  try { editor.Canvas.setZoom?.(100); } catch {}
}
function canvasFitViewport() {
  // Newer GrapesJS exposes fitViewport; when unavailable, fall back to a
  // heuristic: reset zoom + pick a zoom that maps content height onto the
  // available canvas height, capped at 100%.
  try {
    const canvas = editor.Canvas;
    if (canvas.fitViewport) {
      const frame = canvas.getFrame?.();
      canvas.fitViewport(frame ? { frame } : {});
      return;
    }
    canvas.setZoom?.(100);
    const doc = canvas.getDocument?.();
    const frameEl = canvas.getFrameEl?.();
    if (!doc || !frameEl) return;
    const contentH = doc.documentElement.scrollHeight || doc.body.scrollHeight;
    const availH = frameEl.clientHeight;
    if (contentH && availH && contentH > availH) {
      const pct = Math.max(25, Math.floor((availH / contentH) * 100));
      canvas.setZoom?.(pct);
    }
    canvasScrollToTop();
  } catch {}
}

document.getElementById('btn-view-top').addEventListener('click', canvasScrollToTop);
document.getElementById('btn-view-fit').addEventListener('click', canvasFitViewport);
document.getElementById('btn-view-100').addEventListener('click', () => {
  canvasResetZoom();
  canvasScrollToTop();
});

/* -------------------------------------------------------------------------- */
/* Undo / Redo, GrapesJS UndoManager wired to buttons + shortcuts            */
/* -------------------------------------------------------------------------- */

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

function refreshUndoButtons() {
  try {
    const um = editor.UndoManager;
    btnUndo.disabled = !um.hasUndo();
    btnRedo.disabled = !um.hasRedo();
  } catch { btnUndo.disabled = btnRedo.disabled = true; }
}
btnUndo.addEventListener('click', () => { try { editor.UndoManager.undo(); } catch {} });
btnRedo.addEventListener('click', () => { try { editor.UndoManager.redo(); } catch {} });
// change:canvasOffset fires on scroll/zoom (not edits) and caused the Undo
// button to look active even after a pure pan. undo/redo events fire after
// each UndoManager action so the disabled state tracks reality.
editor.on('update component:update component:add component:remove undo redo', refreshUndoButtons);
refreshUndoButtons();

/* -------------------------------------------------------------------------- */
/* Delete-with-undo toast                                                      */
/*                                                                             */
/* When a real user delete happens (Del key, context menu, programmatic),     */
/* surface a 6s toast with an Undo link. Two safeguards:                       */
/*   - hasUndo() gate: skip the toast for the burst of removes that fires     */
/*     when Open replaces the canvas content on page load.                    */
/*   - 50ms debounce: deleting a container triggers component:remove for     */
/*     every descendant, coalesce those into one toast for the parent.      */
/* -------------------------------------------------------------------------- */

let _deleteToastTimer = null;
let _deleteToastTop = null;
editor.on('component:remove', (component) => {
  try {
    if (!editor.UndoManager?.hasUndo?.()) return; // load-time churn
    _deleteToastTop = component; // the outermost remove in the burst wins
    if (_deleteToastTimer) return;
    _deleteToastTimer = setTimeout(() => {
      _deleteToastTimer = null;
      const label = componentLabel(_deleteToastTop) || 'element';
      _deleteToastTop = null;
      const t = toast({
        title: 'Deleted',
        body: `<code>${escapeHtml(label)}</code> &nbsp;·&nbsp; <a href="#" data-del-undo style="color:var(--lab)">Undo</a>`,
        kind: 'info',
        ttl: 6000,
      });
      setTimeout(() => {
        const a = document.querySelector('.toast a[data-del-undo]');
        a?.addEventListener('click', (e) => {
          e.preventDefault();
          try { editor.UndoManager.undo(); } catch {}
          t.dismiss();
        });
      }, 0);
    }, 50);
  } catch {}
});

/* -------------------------------------------------------------------------- */
/* Breadcrumbs, always-visible DOM path to the current selection             */
/*                                                                             */
/* Click any crumb to select that ancestor; the right-edge "×" deselects.     */
/* This is the "how do I get back?" affordance: wherever you ended up after   */
/* poking at a nested element, the path + × is always one click away.         */
/* -------------------------------------------------------------------------- */

const breadcrumbsEl = document.getElementById('canvas-breadcrumbs');

function componentLabel(c) {
  try {
    const tag = (c.get?.('tagName') || c.attributes?.tagName || 'div').toLowerCase();
    const cls = (c.getClasses?.() || []).filter(Boolean);
    const id  = c.get?.('attributes')?.id;
    if (id) return `${tag}#${id}`;
    if (cls.length) return `${tag}.${cls[0]}`;
    const name = c.getName?.();
    return name ? `${tag} · ${name}` : tag;
  } catch { return 'el'; }
}

function renderBreadcrumbs() {
  const sel = editor.getSelected?.();
  if (!sel) { breadcrumbsEl.hidden = true; breadcrumbsEl.innerHTML = ''; return; }

  // Walk up through parents to build a full path.
  const chain = [];
  let cur = sel;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent?.();
  }

  const parts = [];
  chain.forEach((c, i) => {
    const isLast = i === chain.length - 1;
    parts.push(`<button type="button" class="crumb${isLast ? ' current' : ''}" data-idx="${i}">${escapeHtml(componentLabel(c))}</button>`);
    if (!isLast) parts.push(`<span class="sep">›</span>`);
  });
  parts.push(`<button type="button" class="clear" title="Deselect (Esc)">× clear</button>`);
  breadcrumbsEl.innerHTML = parts.join('');
  breadcrumbsEl.hidden = false;

  breadcrumbsEl.querySelectorAll('.crumb').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.idx);
      try { editor.select(chain[i]); } catch {}
    });
  });
  breadcrumbsEl.querySelector('.clear').addEventListener('click', () => {
    try { editor.select(null); } catch {}
  });
  // Auto-scroll so the current crumb is visible even on deep trees.
  const current = breadcrumbsEl.querySelector('.crumb.current');
  if (current) current.scrollIntoView({ inline: 'end', block: 'nearest' });
}

editor.on('component:selected', renderBreadcrumbs);
editor.on('component:deselected', renderBreadcrumbs);
editor.on('component:update:attributes', renderBreadcrumbs);

/* Clicking the canvas paper (not an element) clears selection, matches
 * Webflow / Figma convention. canvas:click is GrapesJS's drag-aware resolved
 * click; it won't fire during a drag-to-move. Only deselect when the click
 * actually landed on BODY or HTML, not a real element. */
editor.on('canvas:click', (ev) => {
  try {
    const target = ev?.target;
    const tag = target?.tagName;
    if (!tag || tag === 'BODY' || tag === 'HTML') editor.select(null);
  } catch {}
});

/* Global keyboard shortcuts. Bound at window level so they fire regardless
 * of whether focus is in the canvas iframe or the studio chrome. */
window.addEventListener('keydown', (e) => {
  // Ignore shortcuts while the user is typing into an input / contenteditable.
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key === '0') { e.preventDefault(); canvasResetZoom(); canvasScrollToTop(); return; }
  if (cmd && e.key === '1') { e.preventDefault(); canvasFitViewport(); return; }
  if (cmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault(); try { editor.UndoManager.undo(); } catch {} return;
  }
  if (cmd && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y')) {
    e.preventDefault(); try { editor.UndoManager.redo(); } catch {} return;
  }
  if (cmd && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault(); runVerb('duplicate'); return;
  }
  if (cmd && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault(); runVerb('wrap-in-div'); return;
  }
  if (!cmd && (e.key === 'Delete' || e.key === 'Backspace')) {
    // Only when something is selected on canvas (not when we're just hovering
    // the topbar / panels). getSelected() returns null when nothing's active.
    const sel = editor.getSelected?.();
    if (sel && sel !== editor.DomComponents?.getWrapper?.()) {
      e.preventDefault(); runVerb('delete'); return;
    }
  }
  if (!cmd && e.key === 'Escape') { try { editor.select(null); } catch {} return; }
  if (!cmd && (e.key === 'Home' || e.key === 'g')) { e.preventDefault(); canvasScrollToTop(); return; }
});
document.getElementById('btn-js').addEventListener('click', () => {
  setScriptsDisabled(!scriptsDisabled());
  toast({
    title: scriptsDisabled() ? 'Page scripts off' : 'Page scripts on',
    body: 'Re-open the page to apply.',
    kind: 'info',
  });
});
renderScriptToggle();

function renderScriptToggle() {
  const btn = document.getElementById('btn-js');
  if (!btn) return;
  const off = scriptsDisabled();
  btn.textContent = off ? '⚡ off' : '⚡ on';
  btn.title = off
    ? 'Page scripts disabled, JS-rendered regions (tiles, etc.) will be blank.'
    : 'Page scripts running in the canvas. Click to disable.';
  btn.classList.toggle('js-off', off);
}
document.getElementById('btn-export').addEventListener('click', () => {
  if (currentOpen) {
    const stem = currentOpen.path.replaceAll('/', '-').replace(/\.html$/, '');
    download(`${stem}.html`, reassembleHtml(currentOpen.originalHtml));
  } else {
    const slug = document.getElementById('song-slug').value.trim() || 'new-song';
    download(`${slug}.html`, buildNewPageHtml());
  }
});

/* -------------------------------------------------------------------------- */
/* Find-in-repo side panel                                                    */
/* -------------------------------------------------------------------------- */

const findInput   = document.getElementById('find-input');
const findResults = document.getElementById('find-results');
let findDebounce;

findInput.addEventListener('input', () => {
  clearTimeout(findDebounce);
  const q = findInput.value.trim();
  if (!q) {
    findResults.innerHTML = '<div class="empty">Search the configured repo for files or snippets.</div>';
    return;
  }
  findDebounce = setTimeout(() => runFind(q), 280);
});

async function runFind(q) {
  if (!getToken()) { showSetupModal({ reason: 'no-token' }); return; }
  findResults.innerHTML = '<div class="empty">searching…</div>';
  try {
    const res = await api(`/repo/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'search failed');
    if (!data.results?.length) {
      findResults.innerHTML = '<div class="empty">no matches</div>';
      return;
    }
    findResults.innerHTML = data.results
      .map(r => `<div class="result" data-path="${escapeAttr(r.path)}">
        <div class="path">${escapeHtml(r.path)}</div>
        <div class="snippet">${escapeHtml((r.snippet || '').slice(0, 140))}</div>
      </div>`)
      .join('');
    findResults.querySelectorAll('.result').forEach(el => {
      el.addEventListener('click', async () => {
        const path = el.dataset.path;
        if (path.endsWith('.html') && confirm(`Open ${path} in the editor?`)) {
          loadFromRepo(path, null);
        } else {
          peekFile(path);
        }
      });
    });
  } catch (err) {
    findResults.innerHTML = `<div class="empty">error: ${escapeHtml(err.message)}</div>`;
  }
}

async function peekFile(path) {
  try {
    const res = await api(`/repo/read?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const w = window.open('', '_blank');
    w.document.write(`<pre style="font-family:monospace;padding:20px;white-space:pre-wrap">${escapeHtml(data.content)}</pre>`);
  } catch (err) {
    toast({ title: 'Preview failed', body: escapeHtml(err.message), kind: 'error' });
  }
}

/* -------------------------------------------------------------------------- */
/* Side-panel tabs (Songs / Find)                                             */
/* -------------------------------------------------------------------------- */

function switchPanelTab(tabId) {
  document.querySelectorAll('.panel-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.panel-body').forEach(s => {
    s.hidden = s.dataset.tab !== tabId;
  });
}
document.querySelectorAll('.panel-tab').forEach(btn => {
  btn.addEventListener('click', () => switchPanelTab(btn.dataset.tab));
});

/* -------------------------------------------------------------------------- */
/* Songs panel                                                                 */
/* -------------------------------------------------------------------------- */

const songsList     = document.getElementById('songs-list');
const songsStatus   = document.getElementById('songs-status');
const songsToolbar  = document.getElementById('songs-toolbar');

function slugifyForArt(title, artist, idx) {
  const base = (artist + '-' + title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `song-${idx + 1}`;
}

function markSongsDirty() {
  if (!songsState) return;
  songsState.dirty = true;
  updateSongsStatus();
}

function updateSongsStatus() {
  if (!songsState) {
    songsStatus.hidden = true;
    songsToolbar.hidden = true;
    return;
  }
  songsToolbar.hidden = false;
  const assetCount = songsState.pendingAssets?.length || 0;
  if (!songsState.dirty && !assetCount) {
    songsStatus.hidden = true;
    return;
  }
  songsStatus.hidden = false;
  songsStatus.classList.add('dirty');
  const bits = [];
  if (songsState.dirty) bits.push('unsaved changes');
  if (assetCount) bits.push(`${assetCount} new art file${assetCount > 1 ? 's' : ''}`);
  songsStatus.textContent = bits.join(' · ') + ', Save to commit';
}

function renderSongsPanel() {
  if (!songsState) {
    songsList.innerHTML = `<div class="empty">Open a page that contains a <code>&lt;script type="application/json" id="songs-data"&gt;</code> block to edit songs here.<br><br>Drag an image file onto a card to replace its art.</div>`;
    updateSongsStatus();
    return;
  }
  const { songs } = songsState;
  if (!songs.length) {
    songsList.innerHTML = `<div class="empty">No songs yet. Click <b>+ Add song</b> below.</div>`;
    updateSongsStatus();
    return;
  }
  songsList.innerHTML = '';
  songs.forEach((s, idx) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.draggable = true;
    card.dataset.idx = String(idx);
    card.innerHTML = `
      <div class="song-art">${songArtHtml(s)}</div>
      <div class="song-body">
        <div class="song-title"></div>
        <div class="song-artist"></div>
        <div class="song-meta"></div>
      </div>
      <div class="song-actions">
        <button data-action="edit" title="Edit fields">✎</button>
        <button data-action="delete" title="Remove">×</button>
      </div>
    `;
    card.querySelector('.song-title').textContent = s.title || '(untitled)';
    card.querySelector('.song-artist').textContent = s.artist || '';
    card.querySelector('.song-meta').textContent = `${s.lang || '??'} · ${s.url || '-'}`;
    attachCardHandlers(card, idx);
    songsList.appendChild(card);
  });
  updateSongsStatus();
}

function songArtHtml(s) {
  if (s.artUrl) {
    // Show the preview dataUrl if a drop just staged it; otherwise an <img>
    // pointing at SITE_ORIGIN + the path so the asset resolves in preview.
    const staged = songsState?.pendingAssets?.find(a => s.artUrl && s.artUrl.endsWith(a.path.replace(/^\/?/, '/')));
    const src = staged?.dataUrl || (s.artUrl.startsWith('http') ? s.artUrl : SITE_ORIGIN + s.artUrl);
    return `<img src="${escapeAttr(src)}" alt="">`;
  }
  return s.art || '';
}

/* ----- card: click / edit / delete / drag-reorder / file-drop ------------- */

let dragSrcIdx = null;

function attachCardHandlers(card, idx) {
  // action buttons
  card.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'delete') removeSong(idx);
      else if (action === 'edit') expandSongEditor(card, idx);
    });
  });
  // click card → expand editor
  card.addEventListener('click', () => expandSongEditor(card, idx));

  // drag reorder (cards)
  card.addEventListener('dragstart', (e) => {
    // Skip dragstart when the drag is actually a file being dragged IN from the OS;
    // file drags originate outside the card so this event is fine for card-reorder.
    dragSrcIdx = idx;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch {}
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    songsList.querySelectorAll('.song-card').forEach(c => {
      c.classList.remove('drop-before', 'drop-after', 'drop-target');
    });
    dragSrcIdx = null;
  });

  // dragover handles both "reorder a card" and "drop an image file"
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    const isFile = Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
    if (isFile) {
      card.classList.add('drop-target');
      e.dataTransfer.dropEffect = 'copy';
    } else if (dragSrcIdx !== null && dragSrcIdx !== idx) {
      const r = card.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      card.classList.toggle('drop-before', before);
      card.classList.toggle('drop-after', !before);
      e.dataTransfer.dropEffect = 'move';
    }
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drop-target', 'drop-before', 'drop-after');
  });

  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drop-target', 'drop-before', 'drop-after');

    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      await handleArtDrop(idx, files[0]);
      return;
    }
    if (dragSrcIdx !== null && dragSrcIdx !== idx) {
      const r = card.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      moveSong(dragSrcIdx, before ? idx : idx + 1);
    }
  });
}

/* ----- song editor (inline) ----- */

let openEditorIdx = null;

function expandSongEditor(card, idx) {
  if (openEditorIdx === idx) return;        // already open for this one
  closeSongEditor();
  openEditorIdx = idx;
  const s = songsState.songs[idx];
  const ed = document.createElement('div');
  ed.className = 'song-editor';
  ed.innerHTML = `
    <button class="song-editor-close" aria-label="close">×</button>
    <label>Title</label><input type="text" data-field="title">
    <label>Artist</label><input type="text" data-field="artist">
    <div class="row-two">
      <div><label>Language</label><input type="text" data-field="lang" maxlength="4"></div>
      <div><label>Length</label><input type="text" data-field="len" placeholder="mm:ss"></div>
    </div>
    <label>URL</label><input type="text" data-field="url">
    <div class="row-two">
      <div><label>Card accent</label><input type="color" data-field="cardAccent"></div>
      <div><label>Card ink</label><input type="color" data-field="cardInk"></div>
    </div>
  `;
  ed.querySelectorAll('[data-field]').forEach(inp => {
    const f = inp.dataset.field;
    inp.value = s[f] || (inp.type === 'color' ? '#000000' : '');
    inp.addEventListener('input', () => {
      s[f] = inp.value;
      // mini-updates to the card display
      if (f === 'title') card.querySelector('.song-title').textContent = inp.value || '(untitled)';
      if (f === 'artist') card.querySelector('.song-artist').textContent = inp.value;
      if (f === 'lang' || f === 'url') {
        card.querySelector('.song-meta').textContent = `${s.lang || '??'} · ${s.url || '-'}`;
      }
      markSongsDirty();
    });
  });
  ed.querySelector('.song-editor-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongEditor();
  });
  card.insertAdjacentElement('afterend', ed);
}
function closeSongEditor() {
  const el = songsList.querySelector('.song-editor');
  if (el) el.remove();
  openEditorIdx = null;
}

/* ----- song ops ----- */

function removeSong(idx) {
  if (!confirm(`Remove "${songsState.songs[idx]?.title || 'this song'}" from the rack?`)) return;
  songsState.songs.splice(idx, 1);
  markSongsDirty();
  renderSongsPanel();
}

function moveSong(from, toRaw) {
  const songs = songsState.songs;
  const to = toRaw > from ? toRaw - 1 : toRaw;
  if (from === to) return;
  const [item] = songs.splice(from, 1);
  songs.splice(to, 0, item);
  markSongsDirty();
  renderSongsPanel();
}

document.getElementById('btn-song-add').addEventListener('click', () => {
  if (!songsState) {
    toast({ title: 'No songs block', body: 'Open a page with songs-data first.', kind: 'info' });
    return;
  }
  songsState.songs.push({
    title: 'New song',
    artist: 'Unknown',
    lang: 'EN',
    len: '00:00',
    url: '/songs/new-song/',
    cardAccent: '#e63946',
    cardInk: '#f3e8cf',
    artUrl: '',
  });
  markSongsDirty();
  renderSongsPanel();
});

/* ----- art drop: preprocess + stage ----- */

async function handleArtDrop(idx, file) {
  const song = songsState.songs[idx];
  const slug = slugifyForArt(song.title, song.artist, idx);
  const path = `art/${slug}.png`;
  const toastBox = toast({ title: 'Processing art…', body: file.name, kind: 'info', ttl: 0 });
  try {
    const { blob, dataUrl } = await preprocessImage(file, { size: 256, palette: IMAGE_PALETTE });
    const base64 = await blobToBase64(blob);

    // Drop any previous pending asset for this song (same path → overwrite).
    songsState.pendingAssets = songsState.pendingAssets.filter(a => a.path !== path);
    songsState.pendingAssets.push({ path, base64, dataUrl });

    song.artUrl = '/' + path;
    // Drop legacy inline SVG so artUrl takes precedence on render.
    delete song.art;

    markSongsDirty();
    renderSongsPanel();
    toastBox.dismiss();
    toast({ title: 'Art staged', body: `${path} · ${Math.round(blob.size / 1024)} kb`, kind: 'success' });
  } catch (err) {
    toastBox.dismiss();
    toast({ title: 'Art failed', body: escapeHtml(err.message), kind: 'error', ttl: 8000 });
  }
}

async function preprocessImage(file, { size = 256, palette = IMAGE_PALETTE } = {}) {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Cover-crop to a square so all album art comes out 1:1.
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);

  const img = ctx.getImageData(0, 0, size, size);
  if (palette) {
    quantizeToPalette(img.data, palette);
    ctx.putImageData(img, 0, 0);
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
  return { blob, dataUrl };
}

function quantizeToPalette(pixels, palette) {
  for (let i = 0; i < pixels.length; i += 4) {
    let bestDist = Infinity, best = palette[0];
    for (const p of palette) {
      const dr = pixels[i]     - p[0];
      const dg = pixels[i + 1] - p[1];
      const db = pixels[i + 2] - p[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; best = p; }
    }
    pixels[i] = best[0]; pixels[i + 1] = best[1]; pixels[i + 2] = best[2];
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // dataURL is "data:image/png;base64,AAAA...", strip the prefix.
      resolve(result.split(',', 2)[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* -------------------------------------------------------------------------- */
/* Actions Inspector, panel rendering + live preview toggles                  */
/* -------------------------------------------------------------------------- */

const actionsList    = document.getElementById('actions-list');
const actionsStatus  = document.getElementById('actions-status');
const actionsSummary = document.getElementById('actions-summary');

const ACTION_GROUP_LABELS = {
  'css-transition': 'CSS transitions',
  'css-animation':  'CSS animations',
  'css-keyframes':  'Keyframe definitions',
  'js-listener':    'JS event listeners',
  'html-handler':   'Inline HTML handlers',
};
const ACTION_GROUP_ORDER = [
  'css-transition', 'css-animation', 'js-listener', 'html-handler', 'css-keyframes',
];

function renderActionsPanel() {
  if (!actionsState || !actionsState.actions.length) {
    actionsList.innerHTML = `<div class="empty">No animations or handlers detected${actionsState ? ' on this page' : ' \u2014 open a page first'}.</div>`;
    actionsSummary.hidden = true;
    updateActionsStatus();
    return;
  }
  const { actions, disabled } = actionsState;
  actionsSummary.hidden = false;
  const total = actions.length;
  const off = disabled.size;
  actionsSummary.innerHTML = `<b>${total}</b> action${total === 1 ? '' : 's'} detected${off ? `, <b>${off}</b> disabled` : ''}`;

  const groups = {};
  for (const a of actions) (groups[a.kind] ||= []).push(a);

  const parts = [];
  for (const kind of ACTION_GROUP_ORDER) {
    const items = groups[kind];
    if (!items?.length) continue;
    parts.push(`<div class="action-group">
      <div class="action-group-head">${escapeHtml(ACTION_GROUP_LABELS[kind] || kind)}<span class="action-group-count">${items.length}</span></div>
      ${items.map(actionRowHtml).join('')}
    </div>`);
  }
  actionsList.innerHTML = parts.join('');

  for (const el of actionsList.querySelectorAll('.action-toggle')) {
    if (el.tagName === 'BUTTON') el.addEventListener('click', () => toggleAction(el.dataset.id));
  }
  for (const el of actionsList.querySelectorAll('.sound-play')) {
    el.addEventListener('click', (e) => { e.stopPropagation(); previewSound(el.dataset.id); });
  }
  for (const el of actionsList.querySelectorAll('.sound-remove')) {
    el.addEventListener('click', (e) => { e.stopPropagation(); removeSound(el.dataset.id); });
  }
  // File drop for audio on rows that support sounds.
  for (const row of actionsList.querySelectorAll('.action-row[data-sound="1"]')) {
    attachSoundDrop(row);
  }
  updateActionsStatus();
}

function attachSoundDrop(row) {
  row.addEventListener('dragover', (e) => {
    const hasFile = Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
    if (!hasFile) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^audio\//.test(f.type));
    row.classList.remove('drop-target');
    if (!files.length) return;
    e.preventDefault();
    await handleSoundDrop(row.dataset.id, files[0]);
  });
}

function actionRowHtml(a) {
  const isDisabled = actionsState.disabled.has(a.id);
  const canToggle  = !!(a.disableCss || a.runtime);
  const canSound   = !!a.runtime; // sounds only make sense on triggers
  const sound      = actionsState.sounds?.find(s => s.id === a.id);
  return `<div class="action-row ${isDisabled ? 'disabled' : ''}" data-id="${escapeAttr(a.id)}" data-sound="${canSound ? '1' : '0'}">
    <div class="action-body">
      <div class="action-title">${escapeHtml(a.title)}</div>
      <div class="action-desc">${escapeHtml(a.meta)}</div>
      <div class="action-meta">id: <code>${escapeHtml(a.id)}</code>${
        canSound && !sound ? ` · <span class="action-hint">drop an audio file to attach a sound</span>` : ''
      }</div>
      ${sound ? `
        <div class="action-sound">
          <button class="sound-play" data-id="${escapeAttr(a.id)}" title="preview">▸</button>
          <code class="sound-path">${escapeHtml(sound.src)}</code>
          <button class="sound-remove" data-id="${escapeAttr(a.id)}" title="remove sound">×</button>
        </div>` : ''}
    </div>
    ${canToggle
      ? `<button class="action-toggle ${isDisabled ? 'off' : 'on'}" data-id="${escapeAttr(a.id)}" title="${isDisabled ? 'enable' : 'disable'}"></button>`
      : `<span class="action-toggle" title="read-only" style="opacity:.35;cursor:default"></span>`}
  </div>`;
}

function updateActionsStatus() {
  if (!actionsState) { actionsStatus.hidden = true; return; }
  if (!actionsState.dirty) { actionsStatus.hidden = true; return; }
  actionsStatus.hidden = false;
  actionsStatus.classList.add('dirty');
  const n = actionsState.disabled.size;
  actionsStatus.textContent = `${n} action${n === 1 ? '' : 's'} disabled \u2014 Save to commit`;
}

function toggleAction(id) {
  if (!actionsState) return;
  const a = actionsState.actions.find(x => x.id === id);
  if (!a || !(a.disableCss || a.runtime)) return;
  if (actionsState.disabled.has(id)) actionsState.disabled.delete(id);
  else actionsState.disabled.add(id);
  actionsState.dirty = true;
  renderActionsPanel();
  applyActionsOverridesToCanvas();
}

/* ----- Sound attachment ----- */

async function handleSoundDrop(actionId, file) {
  if (!actionsState) return;
  const a = actionsState.actions.find(x => x.id === actionId);
  if (!a) return;
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'mp3').toLowerCase();
  if (!['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    toast({ title: 'Unsupported audio', body: `.${ext}, use mp3 / wav / ogg / m4a / aac`, kind: 'error' });
    return;
  }
  if (file.size > 12_000_000) {
    toast({ title: 'Audio too big', body: `${Math.round(file.size / 1024 / 1024)}MB, keep under 12MB`, kind: 'error' });
    return;
  }
  const path = `sounds/${slugifyId(actionId)}.${ext}`;
  const busy = toast({ title: 'Staging sound…', body: file.name, kind: 'info', ttl: 0 });
  try {
    const base64  = await fileToBase64(file);
    const dataUrl = await fileToDataUrl(file);
    actionsState.pendingAudio ||= [];
    actionsState.pendingAudio = actionsState.pendingAudio.filter(p => p.path !== path);
    actionsState.pendingAudio.push({ path, base64, dataUrl });

    actionsState.sounds ||= [];
    // Remove any previous sound binding for this id, then add the new one.
    actionsState.sounds = actionsState.sounds.filter(s => s.id !== actionId);
    actionsState.sounds.push({ id: actionId, src: '/' + path, _preview: dataUrl });

    actionsState.dirty = true;
    renderActionsPanel();
    busy.dismiss();
    toast({ title: 'Sound attached', body: `${path} · ${Math.round(file.size / 1024)} kb`, kind: 'success' });
  } catch (err) {
    busy.dismiss();
    toast({ title: 'Sound staging failed', body: escapeHtml(err.message), kind: 'error', ttl: 8000 });
  }
}

function removeSound(actionId) {
  if (!actionsState) return;
  actionsState.sounds = (actionsState.sounds || []).filter(s => s.id !== actionId);
  actionsState.dirty = true;
  renderActionsPanel();
}

function previewSound(actionId) {
  const s = actionsState?.sounds?.find(x => x.id === actionId);
  if (!s) return;
  const src = s._preview || s.src;
  const a = new Audio(src);
  a.play().catch(err => {
    toast({ title: 'Preview failed', body: escapeHtml(err.message), kind: 'error' });
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',', 2)[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Inject (or refresh) the override <style> + capture-phase listeners inside
 *  the canvas iframe so disabled actions show their disabled state live.
 *  Distinct markers from the save-time artifacts so the two don't conflict.
 *
 *  Tracked listeners live in `actionsCanvasListeners` so we can remove them
 *  cleanly when the disabled set changes or another file is opened. */
let actionsCanvasListeners = [];

function applyActionsOverridesToCanvas() {
  const doc = editor.Canvas?.getDocument?.();
  if (!doc || !actionsState) return;

  // Clear prior live-injected CSS + listeners.
  doc.querySelectorAll('[data-studio-actions-live]').forEach(el => el.remove());
  for (const { event, fn } of actionsCanvasListeners) {
    try { doc.removeEventListener(event, fn, true); } catch {}
  }
  actionsCanvasListeners = [];

  const disabled = [...actionsState.disabled];
  if (!disabled.length) {
    doc.documentElement.removeAttribute('data-actions-disabled');
    return;
  }
  doc.documentElement.setAttribute('data-actions-disabled', disabled.join(' '));

  // CSS overrides (transitions + animations).
  const cssParts = [];
  for (const a of actionsState.actions) {
    if (!actionsState.disabled.has(a.id) || !a.disableCss) continue;
    const guarded = a.disableCss.replace(/^(\s*)([^{]+)\{/, (_, pre, sel) =>
      `${pre}html[data-actions-disabled~="${a.id}"] ${sel.trim()} {`
    );
    cssParts.push(guarded);
  }
  if (cssParts.length) {
    const style = doc.createElement('style');
    style.setAttribute('data-studio-actions-live', '1');
    style.textContent = cssParts.join('\n');
    doc.head.appendChild(style);
  }

  // JS listener + inline handler intercepts, grouped per event type.
  const byEvent = {};
  for (const a of actionsState.actions) {
    if (!actionsState.disabled.has(a.id) || !a.runtime) continue;
    (byEvent[a.runtime.event] = byEvent[a.runtime.event] || []).push({
      id: a.id, selector: a.runtime.selector,
    });
  }
  Object.entries(byEvent).forEach(([event, triggers]) => {
    const fn = (ev) => {
      for (const t of triggers) {
        let matches = false;
        try { matches = ev.target && (ev.target.matches(t.selector) || ev.target.closest(t.selector)); }
        catch (_) {}
        if (matches) { ev.stopImmediatePropagation(); return; }
      }
    };
    try {
      doc.addEventListener(event, fn, true);
      actionsCanvasListeners.push({ event, fn });
    } catch {}
  });
}

/* -------------------------------------------------------------------------- */
/* Command registry                                                            */
/*                                                                             */
/* One place that defines every verb users can invoke. Keyboard shortcuts,    */
/* context-menu items, and toolbar buttons all dispatch through runVerb()     */
/* so behavior stays consistent and we can surface them in a shortcuts        */
/* cheat-sheet later. Each verb is self-contained, it reads the current      */
/* selection from editor.getSelected() and runs against it.                   */
/* -------------------------------------------------------------------------- */

const VERBS = {
  'select-parent': {
    label: 'Select parent',
    shortcut: 'esc→↑',
    run: () => { try { const s = editor.getSelected(); s?.parent?.() && editor.select(s.parent()); } catch {} },
    canRun: () => !!editor.getSelected()?.parent?.(),
  },
  'duplicate': {
    label: 'Duplicate',
    shortcut: '⌘D',
    run: () => {
      try {
        const s = editor.getSelected();
        if (!s) return;
        const parent = s.parent();
        if (!parent) return;
        const idx = parent.components().indexOf(s);
        const clone = s.clone();
        parent.append(clone, { at: idx + 1 });
        editor.select(clone);
      } catch {}
    },
    canRun: () => !!editor.getSelected()?.parent?.(),
  },
  'wrap-in-div': {
    label: 'Wrap in container',
    shortcut: '⌘⇧G',
    run: () => {
      try {
        const s = editor.getSelected();
        const parent = s?.parent?.();
        if (!s || !parent) return;
        const idx = parent.components().indexOf(s);
        const wrapper = parent.append({ tagName: 'div', attributes: { class: 'bx-wrap' } }, { at: idx })[0];
        wrapper.append(s);
        editor.select(wrapper);
      } catch {}
    },
    canRun: () => !!editor.getSelected()?.parent?.(),
  },
  'copy': {
    label: 'Copy',
    shortcut: '⌘C',
    run: () => { try { editor.runCommand('core:copy'); } catch {} },
    canRun: () => !!editor.getSelected(),
  },
  'paste': {
    label: 'Paste',
    shortcut: '⌘V',
    run: () => { try { editor.runCommand('core:paste'); } catch {} },
    canRun: () => true,
  },
  'delete': {
    label: 'Delete',
    shortcut: 'Del',
    run: () => {
      try {
        const s = editor.getSelected();
        if (s && s !== editor.DomComponents.getWrapper()) s.remove();
      } catch {}
    },
    canRun: () => {
      const s = editor.getSelected();
      return !!s && s !== editor.DomComponents.getWrapper();
    },
    danger: true,
  },
};

function runVerb(id) {
  const v = VERBS[id];
  if (v?.canRun?.() === false) return;
  v?.run?.();
}

/* -------------------------------------------------------------------------- */
/* Layers panel, component tree view                                          */
/*                                                                             */
/* GrapesJS keeps component state in a Backbone collection off the wrapper;    */
/* we walk it to build our own tree UI styled to match the studio chrome.     */
/* Click a row to select that component on canvas. Caret toggles children.    */
/* Selection in the canvas reflects back to the tree via component:selected.  */
/* -------------------------------------------------------------------------- */

const layersTree = document.getElementById('layers-tree');
const collapsedLayers = new Set();

function layerNodeLabel(c) {
  try {
    const tag = (c.get?.('tagName') || 'div').toLowerCase();
    const attrs = c.get?.('attributes') || {};
    const id = attrs.id;
    const cls = (c.getClasses?.() || []).filter(Boolean);
    if (id) return { tag, name: `#${id}` };
    if (cls.length) return { tag, name: `.${cls[0]}${cls.length > 1 ? ` +${cls.length - 1}` : ''}` };
    // Text component: preview first ~24 chars of content.
    if (c.get?.('type') === 'textnode') {
      const txt = (c.get('content') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      return { tag: '#text', name: txt ? `"${txt}${txt.length === 24 ? '…' : ''}"` : '(empty)' };
    }
    return { tag, name: c.get?.('name') || '' };
  } catch { return { tag: 'el', name: '' }; }
}

function layerCid(c) {
  // GrapesJS components have a stable cid (Backbone). Use it as our DOM key.
  return c?.cid || c?.get?.('ccid') || String(Math.random());
}

function renderLayers() {
  if (!editor?.getWrapper) return;
  const wrapper = editor.getWrapper();
  if (!wrapper || wrapper.components().length === 0) {
    layersTree.innerHTML = `<div class="empty">Open a page to see the layer tree. Click any row to select; the canvas follows.</div>`;
    return;
  }
  const selected = editor.getSelected?.();
  const selectedCid = selected ? layerCid(selected) : null;
  const html = wrapper.components().map(c => renderLayerNode(c, 0, selectedCid)).join('');
  layersTree.innerHTML = html;

  layersTree.querySelectorAll('.layer-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('caret')) return; // handled below
      const cid = row.dataset.cid;
      const comp = findComponentByCid(cid);
      if (comp) try { editor.select(comp); } catch {}
    });
    row.querySelector('.caret')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const cid = row.dataset.cid;
      if (collapsedLayers.has(cid)) collapsedLayers.delete(cid);
      else collapsedLayers.add(cid);
      renderLayers();
    });
  });
}

function renderLayerNode(c, depth, selectedCid) {
  const { tag, name } = layerNodeLabel(c);
  const cid = layerCid(c);
  const kids = c.components?.() || [];
  const hasKids = kids.length > 0;
  const collapsed = collapsedLayers.has(cid);
  const caret = hasKids
    ? `<span class="caret">${collapsed ? '▸' : '▾'}</span>`
    : `<span class="caret placeholder">·</span>`;
  const isSel = cid === selectedCid;
  const indent = 8 + depth * 12;
  const row = `
    <div class="layer-row ${isSel ? 'selected' : ''} ${collapsed ? 'collapsed' : ''}"
         data-cid="${escapeAttr(cid)}" style="padding-left:${indent}px">
      ${caret}
      <span class="tag">${escapeHtml(tag)}</span>
      <span class="name">${escapeHtml(name)}</span>
    </div>`;
  if (!hasKids || collapsed) return row;
  const children = kids.map(k => renderLayerNode(k, depth + 1, selectedCid)).join('');
  return row + `<div class="layer-children">${children}</div>`;
}

function findComponentByCid(cid) {
  let found = null;
  const walk = (c) => {
    if (found) return;
    if (layerCid(c) === cid) { found = c; return; }
    const kids = c.components?.() || [];
    for (let i = 0; i < kids.length && !found; i++) walk(kids.models ? kids.models[i] : kids[i]);
  };
  try {
    const w = editor.getWrapper();
    if (w) walk(w);
  } catch {}
  return found;
}

editor.on('component:selected component:deselected component:add component:remove component:update:components', renderLayers);
renderLayers();

/* -------------------------------------------------------------------------- */
/* Right-click context menu                                                    */
/*                                                                             */
/* The canvas iframe has its own document; contextmenu events there are       */
/* separate from the parent. We bind when the iframe is ready (after open or  */
/* initial load) and pop a custom menu positioned in the parent viewport at   */
/* the iframe-relative click coords + the iframe's on-page offset.            */
/* -------------------------------------------------------------------------- */

const ctxMenu = document.getElementById('ctx-menu');
let ctxBoundDoc = null;

const CTX_ITEMS = [
  { verb: 'select-parent' },
  { verb: 'duplicate' },
  { verb: 'wrap-in-div' },
  { sep: true },
  { verb: 'copy' },
  { verb: 'paste' },
  { sep: true },
  { verb: 'delete', danger: true },
];

function openContextMenu(pageX, pageY, target) {
  try { if (target) editor.select(target); } catch {}
  const parts = [];
  for (const item of CTX_ITEMS) {
    if (item.sep) { parts.push(`<div class="ctx-sep"></div>`); continue; }
    const v = VERBS[item.verb];
    if (!v) continue;
    const disabled = v.canRun?.() === false;
    const cls = item.danger ? 'ctx-danger' : '';
    parts.push(
      `<button type="button" class="${cls}" data-verb="${escapeAttr(item.verb)}" ${disabled ? 'disabled' : ''} role="menuitem">
        <span>${escapeHtml(v.label)}</span>
        <span class="ctx-shortcut">${escapeHtml(v.shortcut || '')}</span>
      </button>`
    );
  }
  ctxMenu.innerHTML = parts.join('');
  ctxMenu.hidden = false;
  // Position; clamp to viewport edges.
  const { innerWidth: W, innerHeight: H } = window;
  const rect = ctxMenu.getBoundingClientRect();
  const menuW = rect.width || 180, menuH = rect.height || 40;
  const x = Math.min(pageX, W - menuW - 8);
  const y = Math.min(pageY, H - menuH - 8);
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top  = `${y}px`;

  ctxMenu.querySelectorAll('button[data-verb]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeContextMenu();
      runVerb(btn.dataset.verb);
    });
  });
}
function closeContextMenu() {
  ctxMenu.hidden = true;
  ctxMenu.innerHTML = '';
}

// Clicks anywhere (parent window) close the menu.
window.addEventListener('click', (e) => { if (!ctxMenu.contains(e.target)) closeContextMenu(); }, true);
window.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('resize', closeContextMenu);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); }, true);

function bindContextMenuToCanvas(doc) {
  if (!doc || doc === ctxBoundDoc) return;
  ctxBoundDoc = doc;
  doc.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Resolve the element's GrapesJS component.
    let comp = null;
    try {
      const el = e.target;
      const w = editor.getWrapper();
      // Walk the component tree and match by DOM node.
      const find = (c) => {
        if (!c) return null;
        if (c.getEl?.() === el) return c;
        const kids = c.components?.() || [];
        for (const k of kids.models ? kids.models : kids) {
          const hit = find(k);
          if (hit) return hit;
        }
        return null;
      };
      comp = find(w);
      // If the exact element isn't a known component, walk up the DOM.
      if (!comp) {
        let node = el;
        while (node && !comp) {
          const walk = (c) => {
            if (!c) return null;
            if (c.getEl?.() === node) return c;
            const kids = c.components?.() || [];
            for (const k of kids.models ? kids.models : kids) { const hit = walk(k); if (hit) return hit; }
            return null;
          };
          comp = walk(w);
          if (!comp) node = node.parentElement;
        }
      }
    } catch {}
    // Translate iframe coords to page coords.
    const frameEl = editor.Canvas.getFrameEl?.();
    const frameRect = frameEl?.getBoundingClientRect?.() || { left: 0, top: 0 };
    openContextMenu(frameRect.left + e.clientX, frameRect.top + e.clientY, comp);
  });
}

editor.on('canvas:frame:load load', () => {
  const doc = editor.Canvas?.getDocument?.();
  if (doc) bindContextMenuToCanvas(doc);
});
// Also bind post-Open, since loadFromRepo can swap iframe content without
// firing canvas:frame:load again.
editor.on('component:add', () => {
  const doc = editor.Canvas?.getDocument?.();
  if (doc) bindContextMenuToCanvas(doc);
});

/* -------------------------------------------------------------------------- */
/* First-run, if no token, nudge the setup modal                             */
/* -------------------------------------------------------------------------- */

try {
  const prev = JSON.parse(localStorage.getItem(OPEN_STATE_KEY) || 'null');
  if (prev?.path && prev?.sha) {
    currentOpen = { path: prev.path, sha: prev.sha, originalHtml: '' };
    document.getElementById('mode-label').title = 'Tip: re-open via the Open button to refresh the file contents.';
  }
} catch {}
renderMode();

if (!getToken()) {
  setTimeout(() => showSetupModal({ reason: 'no-token' }), 400);
}
