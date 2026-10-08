'use strict'

/**
 * BODHA for Windows — the desktop shell.
 *
 * BODHA is one product with one source of truth: the web app. Everything heavy —
 * the model chain, retrieval over the Indian Knowledge Systems corpus, OCR, web
 * search, the code sandbox, and every document BODHA builds — runs on the server.
 * The desktop app is the window onto it, and like the Android app it adds only
 * what a browser tab cannot give: a real application window with its own icon and
 * menu, remembered size and position, links that open in the default browser
 * instead of taking the app away, a microphone that asks once and keeps working,
 * downloads that land in the Downloads folder, and a page of our own instead of
 * the browser's error screen when the network drops.
 *
 * There is no bundler, no framework and no third-party dependency in here — one
 * file, read top to bottom.
 */

const { app, BrowserWindow, Menu, ipcMain, net, screen, session, shell } = require('electron')
const fs = require('fs')
const path = require('path')

/* ───────────────────────────── what BODHA is ───────────────────────────── */

// BODHA_HOME exists so the shell can be pointed at a preview deployment while
// testing; the shipped app always uses the production URL.
const HOME_URL = process.env.BODHA_HOME || 'https://bodha-ai-three.vercel.app/'
const HOME_HOSTS = new Set(['bodha-ai-three.vercel.app', 'bodha-ai-git-main-srijan7815.vercel.app'])
try {
  HOME_HOSTS.add(new URL(HOME_URL).host)
} catch {
  /* a malformed override simply leaves the production hosts in place */
}

// The app's own paper and ink, so the window has no white flash and no grey frame.
const PAPER = '#FAF7F2'
const INK = '#2B2723'
const TERRACOTTA = '#C1633B'

const OFFLINE_PAGE = 'file://' + path.join(__dirname, 'offline.html').split(path.sep).join('/')

let win = null
/** While non-null, a timer is trying to get back to the real site. */
let retryTimer = null

/**
 * True once a page has failed to load in this window. Chromium draws its own
 * error page after a failure and then reports that as a finished load, so a
 * plain "did-finish-load" is not proof that BODHA arrived.
 */
let pageFailed = false

// BODHA_LOG=1 prints what the shell is doing on stderr. It is how the build
// script checks that the app really boots, and how a support question gets
// answered without a special build.
const LOG = process.env.BODHA_LOG === '1'
const log = (...args) => { if (LOG) console.log('[bodha]', ...args) }

/* ─────────────────────────── remembered window ─────────────────────────── */

const statePath = () => path.join(app.getPath('userData'), 'window-state.json')

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    if (!state || typeof state.width !== 'number' || typeof state.height !== 'number') return null
    // A monitor may have been unplugged since last time; only reuse a rectangle
    // that is still on a screen the user actually has.
    const onScreen = screen.getAllDisplays().some((display) => {
      const area = display.workArea
      const x = typeof state.x === 'number' ? state.x : area.x
      const y = typeof state.y === 'number' ? state.y : area.y
      return x + 120 > area.x && x < area.x + area.width - 120
        && y + 40 > area.y && y < area.y + area.height - 40
    })
    return onScreen ? state : null
  } catch {
    return null // no state yet, or a half-written one — defaults are fine
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return
  try {
    const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
    fs.writeFileSync(statePath(), JSON.stringify({
      ...bounds,
      maximized: win.isMaximized(),
    }))
  } catch {
    /* a window that cannot remember itself is not worth an error dialog */
  }
}

/* ────────────────────────────── navigation ─────────────────────────────── */

const isInternal = (url) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && HOME_HOSTS.has(parsed.host)) return true
    // A local server, so the shell can be tested end to end on this machine.
    const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    return parsed.protocol === 'http:' && local && process.env.BODHA_HOME != null
  } catch {
    return false
  }
}

/** Opens a link in the user's own browser — sources, books, GitHub, mail. */
function openExternally(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      log('opening externally', url)
      shell.openExternal(url)
      return true
    }
  } catch {
    /* not a URL */
  }
  return false
}

/* ─────────────────────────────── the window ────────────────────────────── */

function createWindow() {
  const saved = readWindowState()

  win = new BrowserWindow({
    width: saved?.width ?? 1180,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 380, // the phone layout is a first-class layout, so the window can be narrow
    minHeight: 480,
    show: false,
    backgroundColor: PAPER,
    title: 'BODHA · बोध',
    icon: path.join(__dirname, 'icons', 'bodha-256.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // the composer is for questions, not for documents
    },
  })

  if (saved?.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())
  win.on('resize', saveWindowState)
  win.on('move', saveWindowState)
  win.on('maximize', saveWindowState)
  win.on('unmaximize', saveWindowState)
  win.on('close', saveWindowState)
  win.on('closed', () => {
    win = null
  })

  const contents = win.webContents

  // BODHA's own pages stay in the app; everything else is the user's browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) openExternally(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return
    if (!isInternal(url)) {
      event.preventDefault()
      openExternally(url)
    }
  })

  // Offline: BODHA's own page with a retry, not Chromium's error screen.
  contents.on('did-fail-load', (_event, errorCode, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return // -3 is a cancelled load, not a failure
    if (!isInternal(failedUrl)) return
    log('failed to load', failedUrl, errorCode, description)
    pageFailed = true
    if (!win || win.isDestroyed()) return
    win.loadURL(`${OFFLINE_PAGE}?reason=${encodeURIComponent(description || 'offline')}`)
      .then(() => log('showing the offline page'))
      .catch(() => {})
    startRetrying()
  })

  contents.on('did-finish-load', () => {
    const url = contents.getURL()
    if (!isInternal(url) || pageFailed) return
    stopRetrying()
    log('loaded', url)
    // A build-time self-check: prove the shell boots, then leave quietly.
    if (process.env.BODHA_SMOKE_EXIT === '1') setTimeout(() => app.quit(), 1200)
  })

  // A renderer that dies takes the window's content with it; bring it back.
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    if (win && !win.isDestroyed()) win.loadURL(HOME_URL)
  })

  win.loadURL(HOME_URL)
}

/**
 * While the offline page is up, a quiet check every five seconds — a request made
 * from the shell itself, so the page is only replaced once the server actually
 * answers. Nothing flashes, and nothing is retried against a dead network.
 */
function startRetrying() {
  if (retryTimer) return
  retryTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) return stopRetrying()
    try {
      const res = await net.fetch(HOME_URL, { method: 'GET' })
      if (!res.ok || !win || win.isDestroyed()) return
      log('the network is back — returning to BODHA')
      pageFailed = false
      win.loadURL(HOME_URL)
    } catch {
      /* still offline; the next tick will try again */
    }
  }, 5000)
}

function stopRetrying() {
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = null
}

/* ─────────────────────────── permissions & downloads ───────────────────── */

function installSessionHandlers() {
  const ses = session.defaultSession

  // The microphone, and nothing else. Dictation and Live Mode ask at the moment
  // they are used, exactly as they do in a browser.
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'fullscreen' || permission === 'clipboard-sanitized-write')
  })

  ses.setPermissionCheckHandler((_contents, permission) => (
    permission === 'media' || permission === 'fullscreen' || permission === 'clipboard-sanitized-write'
  ))

  // Files BODHA produces are handed to Windows' own download flow, which asks
  // where to put them once and then gets out of the way.
  ses.on('will-download', (_event, item) => {
    const name = (item.getFilename() || 'bodha-file').replace(/[\\/:*?"<>|]/g, '-')
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) item.setFilename(`${name}.txt`)
  })
}

/* ──────────────────────────────── the menu ─────────────────────────────── */

function currentPage() {
  const url = win && !win.isDestroyed() ? win.webContents.getURL() : ''
  return isInternal(url) ? url : HOME_URL
}

function buildMenu() {
  const goBack = () => {
    if (!win || win.isDestroyed()) return
    const history = win.webContents.navigationHistory
    if (history?.canGoBack?.()) history.goBack()
  }
  const goForward = () => {
    if (!win || win.isDestroyed()) return
    const history = win.webContents.navigationHistory
    if (history?.canGoForward?.()) history.goForward()
  }

  const template = [
    {
      label: 'BODHA',
      submenu: [
        { label: 'About BODHA', click: () => app.showAboutPanel() },
        { type: 'separator' },
        { label: 'Open BODHA in your browser', accelerator: 'CmdOrCtrl+Shift+O', click: () => openExternally(currentPage()) },
        { label: 'Knowledge Shelf', click: () => win?.loadURL(`${HOME_URL}iks`) },
        { type: 'separator' },
        { role: 'quit', label: 'Quit BODHA' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll', label: 'Select all' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: goBack },
        { label: 'Forward', accelerator: 'Alt+Right', click: goForward },
        { type: 'separator' },
        { label: 'Chat', accelerator: 'CmdOrCtrl+1', click: () => win?.loadURL(`${HOME_URL}chat`) },
        { label: 'Library', accelerator: 'CmdOrCtrl+2', click: () => win?.loadURL(`${HOME_URL}library`) },
        { label: 'BODHA\u2019s computer', accelerator: 'CmdOrCtrl+3', click: () => win?.loadURL(`${HOME_URL}computer`) },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win?.loadURL(`${HOME_URL}settings`) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'maximize' },
        { role: 'close', label: 'Close window' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'How to use BODHA', click: () => openExternally(`${HOME_URL}settings`) },
        { label: 'Source on GitHub', click: () => openExternally('https://github.com/srijan7815-bit/bodha-ai') },
        { type: 'separator' },
        { label: `BODHA ${app.getVersion()} — desktop`, enabled: false },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ──────────────────────────────── lifecycle ────────────────────────────── */

// One BODHA at a time: a second launch raises the window that is already open.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.setName('BODHA')
  app.setAppUserModelId('com.bodha.ai.desktop') // one icon in the taskbar, not two

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'BODHA · बोध',
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
      copyright: 'Created by Srijan Singh and Parv Mishra',
      credits: 'An evidence-grounded research copilot for Indian Knowledge Systems — NCSC 2026-27, PM SHRI Kendriya Vidyalaya Kanpur Cantt.',
      website: HOME_URL,
    })

    installSessionHandlers()
    buildMenu()
    createWindow()

    // The offline page's retry button, and anything else the shell needs to hear.
    ipcMain.on('bodha:retry', () => {
      stopRetrying()
      pageFailed = false
      if (win && !win.isDestroyed()) win.loadURL(HOME_URL)
    })
    ipcMain.on('bodha:open-external', (_event, url) => openExternally(String(url)))

    app.on('activate', () => {
      if (!win) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    stopRetrying()
    app.quit()
  })
}
