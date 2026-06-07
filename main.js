const { app, BrowserWindow, session } = require('electron')
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
