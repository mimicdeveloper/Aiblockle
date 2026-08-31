// Toolbar logic: address bar, navigation, AI-safe search, block toggle,
// and the "blocked" interstitial. Runs in the browser-chrome window.

const view = document.getElementById('view');
const address = document.getElementById('address');
const addressForm = document.getElementById('address-form');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const shield = document.getElementById('shield');
const shieldLabel = document.getElementById('shield-label');
const blockedCountEl = document.getElementById('blocked-count');
const blockpage = document.getElementById('blockpage');
const blockedHost = document.getElementById('blocked-host');
const goHome = document.getElementById('go-home');

// A clean, non-AI start page.
const HOME_URL = 'https://duckduckgo.com/';

// DuckDuckGo's HTML results don't inject the AI "answer" panels that Google/Bing
// do, so we route plain searches here. This is the "no AI search" guarantee.
function searchUrl(query) {
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(query) + '&ia=web';
}

// Decide whether the omnibox text is a URL or a search query.
function toUrl(input) {
  const text = input.trim();
  if (!text) return null;

  // Looks like a scheme we allow through directly.
  if (/^https?:\/\//i.test(text)) return text;

  // Looks like a bare domain (has a dot, no spaces) -> treat as URL.
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(text) && !text.includes(' ')) {
    return 'https://' + text;
  }

  // Otherwise: search (AI-free).
  return searchUrl(text);
}

async function navigate(input) {
  const url = toUrl(input);
  if (!url) return;

  const blocked = await window.aiblockle.isBlocked(url);
  if (blocked) {
    showBlockPage(url);
    return;
  }
  hideBlockPage();
  view.loadURL(url).catch(() => { /* ignore navigation aborts */ });
}

function showBlockPage(url) {
  let host = url;
  try { host = new URL(url).hostname; } catch { /* keep raw */ }
  blockedHost.textContent = host;
  blockpage.classList.add('show');
}

function hideBlockPage() {
  blockpage.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Toolbar events
// ---------------------------------------------------------------------------

addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigate(address.value);
});

backBtn.addEventListener('click', () => { if (view.canGoBack()) view.goBack(); });
forwardBtn.addEventListener('click', () => { if (view.canGoForward()) view.goForward(); });
reloadBtn.addEventListener('click', () => view.reload());
goHome.addEventListener('click', () => navigate(HOME_URL));

// ---------------------------------------------------------------------------
// Webview lifecycle
// ---------------------------------------------------------------------------

function updateNavButtons() {
  backBtn.disabled = !view.canGoBack();
  forwardBtn.disabled = !view.canGoForward();
}

view.addEventListener('did-navigate', (e) => {
  address.value = e.url === 'about:blank' ? '' : e.url;
  updateNavButtons();
});
view.addEventListener('did-navigate-in-page', () => updateNavButtons());
view.addEventListener('page-title-updated', () => updateNavButtons());

// If a navigation targets a blocked site (e.g. a link click), show the block page.
view.addEventListener('will-navigate', async (e) => {
  const blocked = await window.aiblockle.isBlocked(e.url);
  if (blocked) {
    view.stop();
    showBlockPage(e.url);
  } else {
    hideBlockPage();
  }
});

// ---------------------------------------------------------------------------
// Block toggle + counter
// ---------------------------------------------------------------------------

function renderShield(state) {
  if (state.enabled) {
    shield.classList.add('on');
    shield.classList.remove('off');
    shieldLabel.textContent = 'AI Blocked';
  } else {
    shield.classList.add('off');
    shield.classList.remove('on');
    shieldLabel.textContent = 'AI Allowed';
  }
  blockedCountEl.textContent = state.count + ' blocked';
}

shield.addEventListener('click', async () => {
  const current = await window.aiblockle.getBlockingState();
  const next = await window.aiblockle.setBlockingEnabled(!current.enabled);
  renderShield(next);
});

window.aiblockle.onBlocked((payload) => {
  blockedCountEl.textContent = payload.count + ' blocked';
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  const state = await window.aiblockle.getBlockingState();
  renderShield(state);
  navigate(HOME_URL);
});
