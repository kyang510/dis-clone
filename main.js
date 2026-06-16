const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

function isLocalAppWindow(webContents) {
  const currentUrl = webContents && webContents.getURL()
  return currentUrl && currentUrl.startsWith('file://')
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isAudioRequest = permission === 'media' && details.mediaTypes && details.mediaTypes.includes('audio')
    callback(isLocalAppWindow(webContents) && isAudioRequest)
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return isLocalAppWindow(webContents) && permission === 'media'
  })
}

function getStoredSessionPath() {
  return path.join(app.getPath('userData'), 'session-token.bin')
}

function configureSecureSessionStorage() {
  ipcMain.handle('session-token:set', async (_event, token) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this device')
    }

    const encryptedToken = safeStorage.encryptString(String(token || ''))
    await fs.writeFile(getStoredSessionPath(), encryptedToken)
    return true
  })

  ipcMain.handle('session-token:get', async () => {
    if (!safeStorage.isEncryptionAvailable()) {
      return null
    }

    try {
      const encryptedToken = await fs.readFile(getStoredSessionPath())
      return safeStorage.decryptString(encryptedToken)
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.log(err)
      }

      return null
    }
  })

  ipcMain.handle('session-token:clear', async () => {
    try {
      await fs.unlink(getStoredSessionPath())
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.log(err)
      }
    }

    return true
  })
}

const createWindow = () => {
  const win = new BrowserWindow({
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: true
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {

    configurePermissions()
    configureSecureSessionStorage()

    createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
