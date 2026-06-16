const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
})

const io = require('socket.io-client');

const API_URL = 'http://localhost:3000';
const SOCKET_CONNECT_TIMEOUT_MS = 5000;
const TOKEN_REFRESH_SKEW_MS = 30 * 1000;

let accessToken = null;
let accessTokenExpiresAt = 0;
let refreshToken = null;
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
    await ensureAccessToken();
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && options.auth && !options.didRefresh) {
    await refreshSession();
    return apiRequest(path, {...options, didRefresh: true});
  }

  return parseApiResponse(response);
}

async function storeRefreshToken(token) {
  refreshToken = token;

  try {
    await ipcRenderer.invoke('session-token:set', token);
  } catch (err) {
    console.log(err);
  }
}

async function readStoredRefreshToken() {
  if (refreshToken) {
    return refreshToken;
  }

  refreshToken = await ipcRenderer.invoke('session-token:get');
  return refreshToken;
}

async function clearStoredRefreshToken() {
  refreshToken = null;

  try {
    await ipcRenderer.invoke('session-token:clear');
  } catch (err) {
    console.log(err);
  }
}

async function applyAuthPayload(data) {
  if (!data || !data.accessToken || !data.refreshToken || !data.user) {
    throw new Error('Invalid authentication response');
  }

  const previousAccessToken = accessToken;
  accessToken = data.accessToken;
  accessTokenExpiresAt = Date.parse(data.accessTokenExpiresAt) || 0;
  currentUser = data.user;

  await storeRefreshToken(data.refreshToken);

  socket.auth = {token: accessToken};

  if (socket.connected && previousAccessToken && previousAccessToken !== accessToken) {
    socket.disconnect();
    socket.connect();
  }

  return {
    success: true,
    message: data.message,
    user: currentUser
  };
}

async function refreshSession() {
  const token = await readStoredRefreshToken();

  if (!token) {
    throw new Error('Log in to continue');
  }

  try {
    const data = await apiRequest('/auth/refresh', {
      method: 'POST',
      body: {refreshToken: token}
    });

    return applyAuthPayload(data);
  } catch (err) {
    await clearSession();
    throw err;
  }
}

async function ensureAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS) {
    return accessToken;
  }

  await refreshSession();
  return accessToken;
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
  await ensureAccessToken();
  socket.auth = {token: accessToken};

  if (!socket.connected) {
    socket.connect();
  }

  try {
    await waitForSocketConnection();
  } catch (err) {
    if (shouldRetry) {
      await refreshSession();
      return ensureSocketConnected(false);
    }

    throw err;
  }
}

function emitWithAuth(eventName, args, callback, shouldRetry = true) {
  ensureSocketConnected()
    .then(() => {
      socket.emit(eventName, ...args, async (res) => {
        if (res && !res.success && res.error === 'Session expired' && shouldRetry) {
          try {
            await refreshSession();
            emitWithAuth(eventName, args, callback, false);
          } catch (err) {
            if (typeof callback === 'function') callback(getAuthError(err));
          }
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
  accessToken = null;
  accessTokenExpiresAt = 0;
  currentUser = null;

  if (socket.connected) {
    socket.disconnect();
  }

  await clearStoredRefreshToken();
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
    await readStoredRefreshToken();
    const result = await refreshSession();
    await ensureSocketConnected();
    return result;
  } catch (err) {
    return getAuthError(err);
  }
}

async function logout() {
  const token = refreshToken;

  try {
    if (token) {
      await apiRequest('/logout', {
        method: 'POST',
        body: {refreshToken: token}
      });
    }
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
  getCurrentUser: () => currentUser,
  sendMessage: (data, callback) => emitWithAuth('chat message', [{
    message: data && data.message,
    channelId: data && data.channelId
  }], callback),
  loadMessages: (channelId, callback) => emitWithAuth('load messages', [{channelId}], callback),
  onMessage: (callback) => socket.on('chat message', callback),
  sendChannel: (name, callback) => emitWithAuth('create-channel', [name], callback),
  onNewChannel: (callback) => socket.on('new-channel', callback),
  createVoiceChannel: (name, callback) => emitWithAuth('create-voice-channel', [name], callback),
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
