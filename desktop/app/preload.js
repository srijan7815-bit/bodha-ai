'use strict'

/**
 * The only bridge between the page and the shell — two verbs, both harmless.
 *
 * The window keeps `contextIsolation` on and `nodeIntegration` off, so the page
 * has no path to the filesystem, to Node or to the user's machine. All this
 * exposes is a retry for the offline page and a way to hand a link to the
 * system's browser.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('BodhaDesktop', {
  version: process.env.BODHA_VERSION || '1.0.0',
  retry: () => ipcRenderer.send('bodha:retry'),
  openExternal: (url) => ipcRenderer.send('bodha:open-external', String(url)),
})
