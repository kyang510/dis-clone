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
  onMessage: (callback) => socket.on('chat message', callback),
  sendChannel: (name, callback) => socket.emit('create-channel', name, callback),
  onNewChannel: (callback) => socket.on('new-channel', callback),
  createVoiceChannel: (name, callback) => socket.emit('create-voice-channel', name, callback),
  joinVoice: (data, callback) => socket.emit('join-voice', data, callback),
  leaveVoice: (callback) => socket.emit('leave-voice', callback),
  sendVoiceOffer: (data) => socket.emit('voice-offer', data),
  sendVoiceAnswer: (data) => socket.emit('voice-answer', data),
  sendVoiceIceCandidate: (data) => socket.emit('voice-ice-candidate', data),
  onVoiceChannels: (callback) => socket.on('voice-channels', callback),
  onVoiceUsers: (callback) => socket.on('voice-users', callback),
  onVoiceUserJoined: (callback) => socket.on('voice-user-joined', callback),
  onVoiceUserLeft: (callback) => socket.on('voice-user-left', callback),
  onVoiceOffer: (callback) => socket.on('voice-offer', callback),
  onVoiceAnswer: (callback) => socket.on('voice-answer', callback),
  onVoiceIceCandidate: (callback) => socket.on('voice-ice-candidate', callback),
  onVoiceError: (callback) => socket.on('voice-error', callback)
});
