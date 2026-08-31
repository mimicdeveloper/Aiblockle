# AIBlockle filtering proxy

The part that can strip AI **inside other websites** — the thing a phone browser
extension would do, but as a hosted service instead, since phone Chrome has no
extensions.

## How it works

You give it a page. The server fetches that page, then:

- **Removes AI media** — images/videos from known AI generators (DALL·E, Midjourney,
  Replicate, Leonardo, Ideogram, Civitai, fal, Runway…) or carrying an explicit AI
  label — replaced with a labeled box that says why.
- **Flags suspected AI media** with a "⚠ Possibly AI" badge (weaker hints; not removed).
- **Flags AI-disclosed text** with a banner above the paragraph.
- **Removes AI widgets** (AI Overview, Copilot panels, "Ask AI", chatbots).
- **Blocks known AI sites** outright with a block page.
- **Strips all page scripts** — so no AI code runs and nothing re-injects what was cleaned.
- **Rewrites links** so clicking stays inside the filter, and points images/CSS at the
  real origin so pages still look right.

A slim top bar shows an address box and a live `blocked · flagged` tally.

## Honest limits

- **Best on content sites** — news, blogs, articles. That's where AI images and
  AI-written text actually appear, and static content proxies cleanly.
- **Breaks on app-like sites** — YouTube, Instagram, anything needing login or heavy
  JavaScript. Scripts are stripped on purpose, so interactive sites won't function.
- It filters **detectable** AI (known sources + labels + disclosures), not literally all AI.
- It's a reading proxy, not a login proxy — don't sign into accounts through it.

## Run locally

```bash
cd proxy
npm install
npm start        # http://localhost:3000
npm test         # offline filter tests (no network)
```

## Deploy it (free) so your phone can use it

**Render (easiest):** push this repo to GitHub → on [render.com](https://render.com)
choose **New → Blueprint** → pick the repo. It reads `render.yaml` and deploys. You get
a public URL like `https://aiblockle-proxy.onrender.com` — open it in phone Chrome and
"Add to Home Screen." (Free instances sleep when idle and take ~30s to wake.)

**Docker (Railway / Fly.io / Cloud Run):** the repo-root `Dockerfile` builds a container:

```bash
docker build -t aiblockle-proxy .
docker run -p 3000:3000 aiblockle-proxy
```

## Files

```
proxy/
  server.js     # the proxy + filter (reuses ../src/main/blocklist.js)
  test.js       # offline filter tests
  package.json
```
