const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const { BLOCKED_DOMAINS } = require('./blocklist');

// ---------------------------------------------------------------------------
// Domain matching
// ---------------------------------------------------------------------------

// Some blocklist entries include a path (e.g. github.com/features/copilot).
// Split those so we can match host + path prefix; the rest match by host only.
const hostEntries = [];
const hostPathEntries = [];
for (const entry of BLOCKED_DOMAINS) {
  const slash = entry.indexOf('/');
  if (slash === -1) {
    hostEntries.push(entry.toLowerCase());
  } else {
    hostPathEntries.push({
      host: entry.slice(0, slash).toLowerCase(),
      pathPrefix: entry.slice(slash).toLowerCase(),
    });
  }
}

function hostMatches(host, entry) {
  // Exact host, or a subdomain of the entry (foo.chatgpt.com matches chatgpt.com).
  return host === entry || host.endsWith('.' + entry);
}

function isBlockedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  for (const entry of hostEntries) {
    if (hostMatches(host, entry)) return true;
  }
  for (const { host: h, pathPrefix } of hostPathEntries) {
    if (hostMatches(host, h) && pathname.startsWith(pathPrefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Blocking state (toggle from the UI)
// ---------------------------------------------------------------------------

let blockingEnabled = true;
let blockedCount = 0;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: '#111418',
    title: 'AIBlockle',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enable the <webview> used as the browsing surface
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Install network-level blocking on the default session and on the session used
// by <webview> guests (they share the default session here).
function installNetworkBlocking() {
  const filter = { urls: ['<all_urls>'] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (blockingEnabled && isBlockedUrl(details.url)) {
      blockedCount += 1;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-blocked', {
          url: details.url,
          count: blockedCount,
        });
      }
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });
}

// ---------------------------------------------------------------------------
// IPC from the toolbar UI
// ---------------------------------------------------------------------------

ipcMain.handle('get-blocking-state', () => ({ enabled: blockingEnabled, count: blockedCount }));

ipcMain.handle('set-blocking-enabled', (_event, enabled) => {
  blockingEnabled = !!enabled;
  return { enabled: blockingEnabled, count: blockedCount };
});

// Let the renderer ask whether a URL would be blocked (used to short-circuit
// navigation and show a friendly block page instead of a network error).
ipcMain.handle('is-blocked', (_event, url) => {
  return blockingEnabled && isBlockedUrl(url);
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  installNetworkBlocking();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
