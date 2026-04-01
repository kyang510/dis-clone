const { contextBridge } = require('electron/renderer')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
})

const io = require('socket.io-client');

const socket = io('http://localhost:3000');

contextBridge.exposeInMainWorld('chatAPI', {
  sendMessage: (data) => socket.emit('chat message', data),
  onMessage: (callback) => socket.on('chat message', callback)
});