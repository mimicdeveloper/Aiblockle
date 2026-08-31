// AIBlockle filtering proxy.
//
// Fetches a page server-side, strips AI media / AI text / AI widgets, rewrites
// links so navigation stays inside the filter, and serves the cleaned HTML.
// This is the only way to filter AI *inside other websites* without a browser
// extension — which phone Chrome doesn't allow.
//
// Honest scope: works well on content sites (news, blogs, articles). App-like
// sites (login-walled, heavily JavaScript-driven) will break — this proxy strips
// page scripts on purpose, both to keep filtering reliable and to stop a page's
// own code from calling AI or undoing the cleaning.

const express = require('express');
const cheerio = require('cheerio');
const {
  BLOCKED_DOMAINS,
  AI_ELEMENT_HINTS,
  AI_KEYWORDS,
  AI_MEDIA_DOMAINS,
  STRONG_AI_LABELS,
  WEAK_AI_HINTS,
  AI_TEXT_DISCLOSURES,
} = require('../src/main/blocklist');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Domain / host helpers
// ---------------------------------------------------------------------------

const blockedHosts = BLOCKED_DOMAINS.filter((d) => !d.includes('/')).map((d) => d.toLowerCase());
const blockedHostPaths = BLOCKED_DOMAINS.filter((d) => d.includes('/')).map((d) => {
  const i = d.indexOf('/');
  return { host: d.slice(0, i).toLowerCase(), path: d.slice(i).toLowerCase() };
});

function hostIn(host, list) {
  host = host.toLowerCase();
  for (const d of list) {
    if (host === d || host.endsWith('.' + d)) return d;
  }
  return null;
}

function isBlockedSite(u) {
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  if (hostIn(host, blockedHosts)) return true;
  for (const { host: h, path } of blockedHostPaths) {
    if ((host === h || host.endsWith('.' + h)) && parsed.pathname.toLowerCase().startsWith(path)) return true;
  }
  return false;
}

function isAiMediaHost(host) {
  return hostIn(host, AI_MEDIA_DOMAINS);
}

// SSRF guard: only http(s), and refuse obviously-internal hosts.
function isSafeTarget(u) {
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const h = parsed.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === '::1' || h === '[::1]') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Text matching helpers
// ---------------------------------------------------------------------------

function containsAny(text, list) {
  for (const n of list) if (text.includes(n)) return n;
  return null;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function matchesWeakHint(text) {
  for (const hint of WEAK_AI_HINTS) {
    if (new RegExp('(^|[^a-z])' + escapeRe(hint) + '([^a-z]|$)', 'i').test(text)) return hint;
  }
  return null;
}

// A proxied navigation URL for a target.
function goUrl(target) {
  return '/go?url=' + encodeURIComponent(target);
}

// Resolve a possibly-relative URL against the page base.
function resolve(base, u) {
  try { return new URL(u, base).href; } catch { return null; }
}

// ---------------------------------------------------------------------------
// The filter: rewrite one page's HTML
// ---------------------------------------------------------------------------

function filterHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const counts = { blocked: 0, flagged: 0 };

  // 1) Remove all scripts (safety + reliability). No AI code runs, nothing
  //    re-injects AI content after we've cleaned it.
  $('script, noscript').remove();

  // 2) Remove AI widgets by known selector / attribute hint.
  const KNOWN_AI_SELECTORS = [
    '[data-attrid="AIOverview"]', 'div[aria-label="AI Overview"]',
    '#bard-container', '.ai-overview', '.copilot', '#b_sydConvContainer',
  ];
  KNOWN_AI_SELECTORS.forEach((sel) => {
    $(sel).each((_, el) => { $(el).remove(); counts.blocked++; });
  });
  $('div,section,aside,iframe,button,a,span').each((_, el) => {
    const $el = $(el);
    let blob = (($el.attr('id') || '') + ' ' + ($el.attr('class') || '') + ' ' +
      ($el.attr('aria-label') || '') + ' ' + ($el.attr('role') || '')).toLowerCase();
    for (const name of Object.keys(el.attribs || {})) {
      if (name.startsWith('data-')) blob += ' ' + name + ' ' + el.attribs[name];
    }
    if (containsAny(blob, AI_ELEMENT_HINTS)) { $el.remove(); counts.blocked++; }
  });

  // 3) Media: block confirmed AI, flag suspected.
  $('img, video').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') || $el.attr('data-src') || $el.attr('srcset') || '';
    const abs = resolve(baseUrl, (src.split(',')[0] || '').trim().split(' ')[0]);
    const host = abs ? new URL(abs).hostname : '';
    const ctx = (($el.attr('alt') || '') + ' ' + ($el.attr('title') || '') + ' ' +
      ($el.attr('aria-label') || '') + ' ' + src + ' ' +
      ($el.closest('figure').find('figcaption').text() || '')).toLowerCase();

    const aiHost = host && isAiMediaHost(host);
    const strong = containsAny(ctx, STRONG_AI_LABELS);
    if (aiHost || strong) {
      const reason = aiHost
        ? 'Loaded from a known AI image/video source (' + aiHost + ')'
        : 'Labeled as AI: “' + strong + '”';
      $el.replaceWith(placeholderBox(reason));
      counts.blocked++;
      return;
    }
    const weak = matchesWeakHint(ctx);
    if (weak) { $el.replaceWith(flagWrap($, $el, 'Contains AI hint: “' + weak + '”')); counts.flagged++; }
  });

  // 4) Text: flag blocks that disclose AI authorship.
  $('p, article, li, blockquote').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-aiblockle')) return;
    const t = $el.text().toLowerCase();
    if (t.length < 12 || t.length > 4000) return;
    const hit = containsAny(t, AI_TEXT_DISCLOSURES);
    if (hit) {
      $el.attr('data-aiblockle', 'flagged');
      $el.before('<div class="aiblockle-text-banner">⚠ Possibly AI-written — text discloses AI authorship: “' + esc(hit) + '”</div>');
      counts.flagged++;
    }
  });

  // 5) Rewrite links + resources.
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const abs = resolve(baseUrl, $el.attr('href'));
    if (!abs || !/^https?:/i.test(abs)) return;      // leave mailto:, #anchors, etc.
    if (isBlockedSite(abs)) {
      $el.attr('href', goUrl(abs));                   // will show the block page
      $el.attr('title', 'AIBlockle: known AI service');
    } else {
      $el.attr('href', goUrl(abs));                   // keep browsing inside the filter
    }
  });

  // Stylesheets + images point straight at the origin (absolute), except AI hosts.
  $('link[href]').each((_, el) => {
    const $el = $(el);
    const abs = resolve(baseUrl, $el.attr('href'));
    if (abs) $el.attr('href', abs);
  });
  $('img, source').each((_, el) => {
    const $el = $(el);
    ['src', 'data-src'].forEach((attr) => {
      const v = $el.attr(attr);
      if (!v) return;
      const abs = resolve(baseUrl, v);
      if (!abs) return;
      if (isAiMediaHost(new URL(abs).hostname)) { $el.remove(); return; }
      $el.attr(attr, abs);
    });
    const ss = $el.attr('srcset');
    if (ss) {
      const rewritten = ss.split(',').map((part) => {
        const bits = part.trim().split(/\s+/);
        const abs = resolve(baseUrl, bits[0]);
        return abs ? [abs, ...bits.slice(1)].join(' ') : part.trim();
      }).join(', ');
      $el.attr('srcset', rewritten);
    }
  });
  // Drop iframes pointing at AI services; make the rest absolute.
  $('iframe[src]').each((_, el) => {
    const $el = $(el);
    const abs = resolve(baseUrl, $el.attr('src'));
    if (!abs) return;
    if (isBlockedSite(abs)) { $el.remove(); counts.blocked++; return; }
    $el.attr('src', abs);
  });

  // 6) Inject our styles + a slim top bar.
  $('head').prepend(
    '<base href="' + esc(baseUrl) + '">' + STYLE
  );
  $('body').prepend(topBar(baseUrl, counts));

  return { html: $.html(), counts };
}

// ---------------------------------------------------------------------------
// HTML fragments
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function placeholderBox(reason) {
  return '<span class="aiblockle-blocked">🛡️ <b>AI media blocked</b><br><small>' + esc(reason) + '</small></span>';
}

function flagWrap($, $img, reason) {
  const wrap = $('<span class="aiblockle-flag"></span>');
  wrap.append($img.clone());
  wrap.append('<span class="aiblockle-badge" title="' + esc(reason) + '">⚠ Possibly AI</span>');
  return wrap;
}

const STYLE = `<style id="aiblockle-style">
  .aiblockle-blocked{display:inline-flex;flex-direction:column;justify-content:center;text-align:center;
    min-width:140px;min-height:90px;padding:12px 14px;margin:2px;border:1px solid #d9b38c;border-radius:10px;
    background:repeating-linear-gradient(45deg,#fbf3e8,#fbf3e8 10px,#f6ead6 10px,#f6ead6 20px);color:#7a4a12;
    font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;vertical-align:middle;}
  .aiblockle-flag{position:relative;display:inline-block;}
  .aiblockle-badge{position:absolute;top:6px;left:6px;background:#e08a2e;color:#241300;font:600 11px/1 sans-serif;
    padding:4px 7px;border-radius:6px;cursor:help;box-shadow:0 1px 4px rgba(0,0,0,.3);z-index:9;}
  .aiblockle-text-banner{background:#fdf1e2;border-left:3px solid #e08a2e;color:#8a4b12;border-radius:6px;
    padding:7px 11px;margin:8px 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  #aiblockle-bar{position:sticky;top:0;z-index:2147483000;display:flex;gap:10px;align-items:center;
    background:#0e1512;color:#e6efe9;padding:9px 12px;font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    box-shadow:0 2px 8px rgba(0,0,0,.35);}
  #aiblockle-bar a{color:#38d39a;text-decoration:none;}
  #aiblockle-bar form{display:flex;flex:1;gap:6px;margin:0;}
  #aiblockle-bar input{flex:1;min-width:0;border:1px solid #25322d;background:#151f1b;color:#e6efe9;
    border-radius:7px;padding:6px 10px;font:inherit;}
  #aiblockle-bar button{border:none;background:#38d39a;color:#04231a;border-radius:7px;padding:6px 12px;font:inherit;cursor:pointer;}
  #aiblockle-bar .tally{color:#8ba099;font-weight:500;white-space:nowrap;}
</style>`;

function topBar(baseUrl, counts) {
  return '<div id="aiblockle-bar">' +
    '<a href="/">🛡️ AIBlockle</a>' +
    '<form action="/go" method="get"><input name="url" value="' + esc(baseUrl) + '" aria-label="Address" /><button>Go</button></form>' +
    '<span class="tally">' + counts.blocked + ' blocked · ' + counts.flagged + ' flagged</span>' +
    '</div>';
}

function pageShell(title, bodyHtml) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title>' + STYLE +
    '<style>body{margin:0;background:#0e1512;color:#e6efe9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
    '.mid{max-width:560px;margin:0 auto;padding:48px 20px;}h1{font-size:26px;margin:0 0 10px;}' +
    'p{color:#8ba099;line-height:1.55;}form{display:flex;gap:8px;margin:22px 0;}' +
    'input{flex:1;min-width:0;border:1px solid #25322d;background:#151f1b;color:#e6efe9;border-radius:10px;padding:12px 14px;font-size:16px;}' +
    'button{border:none;background:#38d39a;color:#04231a;font-weight:600;border-radius:10px;padding:0 18px;font-size:15px;cursor:pointer;}' +
    'a{color:#38d39a;}</style></head><body><div class="mid">' + bodyHtml + '</div></body></html>';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.type('html').send(pageShell('AIBlockle — filtering browser', `
    <h1>🛡️ AIBlockle</h1>
    <p>Browse through an AI filter. Enter a page and AIBlockle fetches it, removes AI images, videos and widgets, flags AI-disclosed text, and blocks known AI sites — then shows you the clean version.</p>
    <form action="/go" method="get">
      <input name="url" inputmode="url" placeholder="Enter a website, e.g. example.com/article" aria-label="Website to open" autofocus />
      <button>Open filtered</button>
    </form>
    <p><b>Works best</b> on articles, blogs and news. <b>Won't work</b> on login-walled or app-like sites (YouTube, Instagram) — page scripts are stripped for safety, so interactive sites break. It filters what's detectable, not literally all AI.</p>
  `));
});

app.get('/go', async (req, res) => {
  const raw = (req.query.url || '').trim();
  if (!raw) return res.redirect('/');
  const target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;

  if (!isSafeTarget(target)) {
    return res.status(400).type('html').send(pageShell('Blocked', `
      <h1>Can't open that</h1><p>Only public http(s) websites are allowed.</p><p><a href="/">← Back</a></p>`));
  }
  if (isBlockedSite(target)) {
    let host = target; try { host = new URL(target).hostname; } catch {}
    return res.type('html').send(pageShell('Blocked — AI service', `
      <h1>🛡️ Blocked</h1>
      <p><b>${esc(host)}</b> is a known AI service, so AIBlockle won't open it.</p>
      <p><a href="/">← Back to safety</a></p>`));
  }

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIBlockle/0.1; +https://github.com/mimicdeveloper/Aiblockle)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });

    const type = upstream.headers.get('content-type') || '';
    // Non-HTML (images, PDFs, etc.): send the browser straight to the origin.
    if (!type.includes('text/html')) return res.redirect(upstream.url || target);

    const html = await upstream.text();
    const { html: cleaned } = filterHtml(html, upstream.url || target);
    res.status(upstream.status).type('html').send(cleaned);
  } catch (err) {
    res.status(502).type('html').send(pageShell('Could not load', `
      <h1>Couldn't load that page</h1>
      <p>The site may be down, blocking proxies, or require a login. (${esc(err.message || 'fetch failed')})</p>
      <p><a href="/">← Back</a></p>`));
  }
});

app.get('/health', (_req, res) => res.type('text').send('ok'));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('AIBlockle proxy listening on http://localhost:' + PORT);
  });
}

// Exported for tests.
module.exports = { app, filterHtml, isBlockedSite, isSafeTarget, isAiMediaHost };
