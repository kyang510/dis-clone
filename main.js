const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')
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
