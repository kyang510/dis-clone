const { contextBridge, ipcRenderer, clipboard } = require('electron')

const io = require('socket.io-client');

const API_URL = 'http://localhost:3000';
const SOCKET_CONNECT_TIMEOUT_MS = 5000;

let sessionToken = null;
let currentUser = null;

const socket = io(API_URL, {
  autoConnect: false
});

function getAuthError(err) {
  return {
    success: false,
    error: (err && err.message) || 'Authentication required'
  };
}

async function parseApiResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (options.auth) {
    await ensureSessionToken();
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  return parseApiResponse(response);
}

async function storeSessionToken(token) {
  sessionToken = token;

  try {
    await ipcRenderer.invoke('session-token:set', token);
  } catch (err) {
    console.log(err);
  }
}

async function readStoredSessionToken() {
  if (sessionToken) {
    return sessionToken;
  }

  sessionToken = await ipcRenderer.invoke('session-token:get');
  return sessionToken;
}

async function clearStoredSessionToken() {
  sessionToken = null;

  try {
    await ipcRenderer.invoke('session-token:clear');
  } catch (err) {
    console.log(err);
  }
}

async function applyAuthPayload(data) {
  if (!data || !data.sessionToken || !data.user) {
    throw new Error('Invalid authentication response');
  }

  const previousSessionToken = sessionToken;
  currentUser = data.user;

  await storeSessionToken(data.sessionToken);

  socket.auth = {token: sessionToken};

  if (socket.connected && previousSessionToken && previousSessionToken !== sessionToken) {
    socket.disconnect();
    socket.connect();
  }

  return {
    success: true,
    message: data.message,
    user: currentUser
  };
}

async function ensureSessionToken() {
  const token = await readStoredSessionToken();

  if (!token) {
    throw new Error('Log in to continue');
  }

  return token;
}

function waitForSocketConnection() {
  if (socket.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Could not connect to chat server'));
    }, SOCKET_CONNECT_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeoutId);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleError);
    }

    function handleConnect() {
      cleanup();
      resolve();
    }

    function handleError(err) {
      cleanup();
      reject(err);
    }

    socket.once('connect', handleConnect);
    socket.once('connect_error', handleError);
  });
}

async function ensureSocketConnected(shouldRetry = true) {
  await ensureSessionToken();
  socket.auth = {token: sessionToken};

  if (!socket.connected) {
    socket.connect();
  }

  try {
    await waitForSocketConnection();
  } catch (err) {
    if (shouldRetry) {
      socket.disconnect();
      return ensureSocketConnected(false);
    }

    throw err;
  }
}

function emitWithAuth(eventName, args, callback, shouldRetry = true) {
  ensureSocketConnected()
    .then(() => {
      socket.emit(eventName, ...args, (res) => {
        if (res && !res.success && res.error === 'Session expired' && shouldRetry) {
          clearSession().finally(() => {
            if (typeof callback === 'function') callback(getAuthError(new Error(res.error)));
          });
          return;
        }

        if (typeof callback === 'function') callback(res);
      });
    })
    .catch((err) => {
      if (typeof callback === 'function') callback(getAuthError(err));
    });
}

function emitWithoutAck(eventName, data) {
  ensureSocketConnected()
    .then(() => socket.emit(eventName, data))
    .catch((err) => console.log(err));
}

async function clearSession() {
  currentUser = null;

  if (socket.connected) {
    socket.disconnect();
  }

  await clearStoredSessionToken();
}

async function login(credentials) {
  try {
    const data = await apiRequest('/login', {
      method: 'POST',
      body: credentials
    });

    return applyAuthPayload(data);
  } catch (err) {
    return getAuthError(err);
  }
}

async function signup(account) {
  try {
    const data = await apiRequest('/signup', {
      method: 'POST',
      body: account
    });

    return applyAuthPayload(data);
  } catch (err) {
    return getAuthError(err);
  }
}

async function restoreSession() {
  try {
    await ensureSessionToken();
    const data = await apiRequest('/me', {auth: true});
    currentUser = data.user;
    socket.auth = {token: sessionToken};
    await ensureSocketConnected();
    return {success: true, user: currentUser};
  } catch (err) {
    await clearSession();
    return getAuthError(err);
  }
}

async function logout() {
  try {
    await apiRequest('/logout', {
      method: 'POST',
      auth: true
    });
  } catch (err) {
    console.log(err);
  }

  await clearSession();
  return {success: true};
}

async function getUsers() {
  try {
    const data = await apiRequest('/users', {auth: true});
    return {success: true, users: data.users || []};
  } catch (err) {
    return {...getAuthError(err), users: []};
  }
}

contextBridge.exposeInMainWorld('chatAPI', {
  signup,
  login,
  logout,
  restoreSession,
  getUsers,
  sendMessage: (data, callback) => emitWithAuth('chat message', [{
    message: data && data.message,
    channelId: data && data.channelId,
    attachment: data && data.attachment
  }], callback),
  loadMessages: (channelId, callback) => emitWithAuth('load messages', [{channelId}], callback),
  onMessage: (callback) => socket.on('chat message', callback),
  editMessage: (data, callback) => emitWithAuth('edit-message', [{
    messageId: data && data.messageId,
    message: data && data.message
  }], callback),
  deleteMessage: (data, callback) => emitWithAuth('delete-message', [{
    messageId: data && data.messageId
  }], callback),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  },
  onMessageEdited: (callback) => socket.on('message-edited', callback),
  onMessageDeleted: (callback) => socket.on('message-deleted', callback),
  sendChannel: (name, callback) => emitWithAuth('create-channel', [name], callback),
  editChannel: (data, callback) => emitWithAuth('edit-channel', [{
    channelId: data && data.channelId,
    name: data && data.name
  }], callback),
  duplicateChannel: (data, callback) => emitWithAuth('duplicate-channel', [{
    channelId: data && data.channelId
  }], callback),
  deleteChannel: (data, callback) => emitWithAuth('delete-channel', [{
    channelId: data && data.channelId
  }], callback),
  onNewChannel: (callback) => socket.on('new-channel', callback),
  createVoiceChannel: (name, callback) => emitWithAuth('create-voice-channel', [name], callback),
  editVoiceChannel: (data, callback) => emitWithAuth('edit-voice-channel', [{
    channelId: data && data.channelId,
    name: data && data.name
  }], callback),
  duplicateVoiceChannel: (data, callback) => emitWithAuth('duplicate-voice-channel', [{
    channelId: data && data.channelId
  }], callback),
  deleteVoiceChannel: (data, callback) => emitWithAuth('delete-voice-channel', [{
    channelId: data && data.channelId
  }], callback),
  joinVoice: (data, callback) => emitWithAuth('join-voice', [{channelId: data && data.channelId}], callback),
  leaveVoice: (callback) => emitWithAuth('leave-voice', [], callback),
  sendVoiceOffer: (data) => emitWithoutAck('voice-offer', data),
  sendVoiceAnswer: (data) => emitWithoutAck('voice-answer', data),
  sendVoiceIceCandidate: (data) => emitWithoutAck('voice-ice-candidate', data),
  onVoiceChannels: (callback) => socket.on('voice-channels', callback),
  onVoiceUsers: (callback) => socket.on('voice-users', callback),
  onVoiceUserJoined: (callback) => socket.on('voice-user-joined', callback),
  onVoiceUserLeft: (callback) => socket.on('voice-user-left', callback),
  onVoiceOffer: (callback) => socket.on('voice-offer', callback),
  onVoiceAnswer: (callback) => socket.on('voice-answer', callback),
  onVoiceIceCandidate: (callback) => socket.on('voice-ice-candidate', callback),
  onVoiceError: (callback) => socket.on('voice-error', callback)
});
