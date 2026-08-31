# AIBlockle 🛡️

A desktop web browser that detects and blocks AI. **No AI sites, no AI search, no AI content.**

AIBlockle is a real browser (built on Electron/Chromium) with three layers of AI
blocking working together:

| Layer | What it does | Where |
|-------|--------------|-------|
| **1. Network** | Refuses to load known AI sites and blocks calls to AI APIs, so AI tools never even open. | `src/main/main.js` + `src/main/blocklist.js` |
| **2. Search** | Routes searches through DuckDuckGo, which returns plain web results — **no AI "answer" panels.** | `src/renderer/renderer.js` |
| **3. Page content** | Injects a filter into every page that hides AI features as they appear: Google "AI Overview", Copilot panels, "Ask AI" buttons, embedded chatbots. | `src/renderer/webview-preload.js` |

A shield button in the toolbar toggles blocking on/off and shows how many AI
requests have been blocked this session.

## Run it

```bash
npm install
npm start
```

That opens the AIBlockle browser window. Try visiting `chatgpt.com` or searching
something on Google — the AI parts are blocked or hidden.

## Honest limits (please read)

Blocking **all** AI perfectly is impossible, and AIBlockle doesn't pretend otherwise:

- **AI-generated text/images look like normal content.** A human-looking blog post
  written by AI arrives as ordinary text — there's no reliable universal signal
  that marks it as AI, so AIBlockle can't catch that.
- **Server-side AI is invisible.** If a website runs AI on its own servers and just
  sends you the finished result, nothing in the traffic reveals it.
- **New AI services appear constantly.** AIBlockle blocks what's on its list. Unknown
  AI tools slip through until they're added — it's the same cat-and-mouse game as ad blocking.

What AIBlockle *does* do well: block the known AI **tools, services, and on-page
features** — the parts that are actually detectable. To catch more, add domains and
selectors to `src/main/blocklist.js`.

## Project layout

```
src/
  main/
    main.js            # Electron main process + network-level blocking
    blocklist.js       # the lists of AI domains / keywords / element hints
    preload.js         # safe bridge between the UI and the main process
  renderer/
    index.html         # browser toolbar (chrome) UI
    renderer.js        # address bar, AI-safe search, toggle, block page
    webview-preload.js # DOM filter injected into every visited page
```

## License

MIT
