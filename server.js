const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('node:crypto');

function isAllowedOrigin(origin) {
  return !origin || origin === 'null' || origin.startsWith('file://') || origin === 'http://localhost:3000';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin))
  }
});
const port = 3000;
const DEFAULT_CHANNEL_ID = 1;
const MESSAGE_HISTORY_LIMIT = 100;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const JWT_ISSUER = 'dis-clone';
const JWT_AUDIENCE = 'dis-clone-client';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const DEFAULT_CHANNELS = [
  {id: 1, name: 'general'},
  {id: 2, name: 'memes'},
  {id: 3, name: 'gaming'},
  {id: 4, name: 'music'}
];
const DEFAULT_VOICE_CHANNELS = [
  {id: 1, name: 'general'},
  {id: 2, name: 'memes'},
  {id: 3, name: 'gaming'},
  {id: 4, name: 'music'}
];

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set. Using a one-time development secret; sessions will expire when the server restarts.');
}

const cors = require("cors");
const bcrypt = require("bcrypt");
const mysql = require('mysql2');

app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin))
}));
app.use(express.json());


// MySQL database connection //remove/change later when deploying (if i do make it into a production app)
const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  database: process.env.DB_NAME || "mywebsite",
  password: process.env.DB_PASSWORD || "joshsucks",
  port: Number(process.env.DB_PORT) || 3306,
});

function dbQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(results);
    });
  });
}

function toMysqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeChannelName(name) {
  return String(name || '').trim();
}

function channelNameKey(name) {
  return normalizeChannelName(name).toLowerCase();
}

async function ensureUsersTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
}

async function ensureSessionTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      refresh_token_hash CHAR(64) NOT NULL,
      user_agent VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP NULL,
      expires_at DATETIME NOT NULL,
      revoked_at TIMESTAMP NULL,
      INDEX idx_sessions_user_id (user_id),
      INDEX idx_sessions_expires_at (expires_at),
      CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function ensureChannelsTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS channels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      name_key VARCHAR(50) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureVoiceChannelsTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS voice_channels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      name_key VARCHAR(50) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureMessagesTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id INT NOT NULL,
      user_id INT NOT NULL,
      username VARCHAR(50) NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMP NULL,
      INDEX idx_messages_channel_id_id (channel_id, id),
      INDEX idx_messages_user_id (user_id),
      CONSTRAINT fk_messages_channel_id FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      CONSTRAINT fk_messages_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  try {
    await dbQuery("ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP NULL");
  } catch (err) {
    if (!err || err.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }
}

async function seedDefaultChannels(tableName, defaults) {
  for (const channel of defaults) {
    await dbQuery(
      `INSERT IGNORE INTO ${tableName} (id, name, name_key) VALUES (?, ?, ?)`,
      [channel.id, channel.name, channelNameKey(channel.name)]
    );
  }
}

async function loadChannelsFromDb() {
  const rows = await dbQuery("SELECT id, name FROM channels ORDER BY id ASC");
  return rows.map((row) => ({
    id: row.id,
    name: row.name
  }));
}

async function loadVoiceChannelsFromDb() {
  const rows = await dbQuery("SELECT id, name FROM voice_channels ORDER BY id ASC");
  return rows.map((row) => ({
    id: row.id,
    name: row.name
  }));
}

async function loadChannelCaches() {
  channels = await loadChannelsFromDb();
  voiceChannels = await loadVoiceChannelsFromDb();
}

async function initializeDatabase() {
  await ensureUsersTable();
  await ensureChannelsTable();
  await ensureVoiceChannelsTable();
  await seedDefaultChannels('channels', DEFAULT_CHANNELS);
  await seedDefaultChannels('voice_channels', DEFAULT_VOICE_CHANNELS);
  await ensureSessionTable();
  await ensureMessagesTable();
  await loadChannelCaches();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signJwt(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
    ...payload
  };
  const header = base64UrlJson({alg: 'HS256', typ: 'JWT'});
  const body = base64UrlJson(jwtPayload);
  const signingInput = `${header}.${body}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

function verifyJwt(token, expectedType) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Invalid token header');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signingInput)
    .digest('base64url');
  const receivedSignatureBuffer = Buffer.from(signature, 'base64url');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

  if (
    receivedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(receivedSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) {
    throw new Error('Invalid token audience');
  }

  if (payload.exp <= now) {
    throw new Error('Token expired');
  }

  if (expectedType && payload.typ !== expectedType) {
    throw new Error('Invalid token type');
  }

  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  return scheme === 'Bearer' ? token : null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeSignupUsername(username) {
  return String(username || '').trim().slice(0, 50);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function createAccessToken(user, sessionId) {
  const accessToken = signJwt({
    typ: 'access',
    sub: String(user.id),
    sid: sessionId,
    username: user.username
  }, ACCESS_TOKEN_TTL_SECONDS);

  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
  };
}

function createRefreshToken(user, sessionId) {
  const refreshToken = signJwt({
    typ: 'refresh',
    sub: String(user.id),
    sid: sessionId,
    jti: crypto.randomUUID()
  }, REFRESH_TOKEN_TTL_SECONDS);

  return {
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  };
}

async function createAuthSession(user, userAgent) {
  const sessionId = crypto.randomUUID();
  const access = createAccessToken(user, sessionId);
  const refresh = createRefreshToken(user, sessionId);

  await dbQuery(
    "INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
    [
      sessionId,
      user.id,
      hashToken(refresh.refreshToken),
      String(userAgent || '').slice(0, 255),
      toMysqlDate(refresh.refreshTokenExpiresAt)
    ]
  );

  return {
    ...access,
    refreshToken: refresh.refreshToken,
    user: publicUser(user)
  };
}

async function getActiveSession(sessionId) {
  const rows = await dbQuery(
    `SELECT sessions.id, sessions.user_id, sessions.refresh_token_hash, users.username
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [sessionId]
  );

  return rows[0] || null;
}

async function getUserFromAccessToken(token) {
  const payload = verifyJwt(token, 'access');
  const session = await getActiveSession(payload.sid);

  if (!session || String(session.user_id) !== String(payload.sub)) {
    throw new Error('Invalid session');
  }

  return {
    id: session.user_id,
    username: session.username,
    sessionId: session.id,
    tokenExpiresAt: payload.exp * 1000
  };
}

async function rotateRefreshSession(refreshToken) {
  const payload = verifyJwt(refreshToken, 'refresh');
  const session = await getActiveSession(payload.sid);

  if (!session || String(session.user_id) !== String(payload.sub)) {
    throw new Error('Invalid session');
  }

  if (session.refresh_token_hash !== hashToken(refreshToken)) {
    await dbQuery("UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ?", [session.id]);
    throw new Error('Invalid refresh token');
  }

  const user = {
    id: session.user_id,
    username: session.username
  };
  const access = createAccessToken(user, session.id);
  const refresh = createRefreshToken(user, session.id);

  await dbQuery(
    "UPDATE sessions SET refresh_token_hash = ?, last_used_at = UTC_TIMESTAMP(), expires_at = ? WHERE id = ?",
    [hashToken(refresh.refreshToken), toMysqlDate(refresh.refreshTokenExpiresAt), session.id]
  );

  return {
    ...access,
    refreshToken: refresh.refreshToken,
    user: publicUser(user)
  };
}

async function revokeRefreshSession(refreshToken) {
  const payload = verifyJwt(refreshToken, 'refresh');
  await dbQuery(
    "UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?",
    [payload.sid, payload.sub]
  );
}

async function requireAuth(req, res, next) {
  try {
    req.user = await getUserFromAccessToken(getBearerToken(req));
    next();
  } catch (err) {
    res.status(401).json({message: 'Authentication required'});
  }
}

app.post("/signup", async (req, res) => {
  const username = normalizeSignupUsername(req.body && req.body.username);
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');

  if (!username || !isValidEmail(email) || password.length < 8) {
    return res.status(400).json({message: "Use a username, valid email, and password with at least 8 characters"});
  }

  const passwordHash = await bcrypt.hash(password, 12);

  db.query(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email, passwordHash],
    async (err, result) => {
      if (err) {
        console.log("/signup INSERT error:", err);
        return res.status(500).json({ message: "Signup failed" });
      }

      try {
        const authSession = await createAuthSession(
          {id: result.insertId, username},
          req.headers['user-agent']
        );
        res.json({ message: "Account created", ...authSession });
      } catch (sessionErr) {
        console.log("/signup session error:", sessionErr);
        res.status(500).json({message: "Account created, but login failed"});
      }
    }
  );
});

app.get("/users", requireAuth, (req, res) => {
  db.query(
    "SELECT id, username FROM users ORDER BY username ASC",
    (err, results) => {
      if (err) {
        console.log("/users SELECT error:", err);
        return res.status(500).json({ message: "Could not load users" });
      }

      res.json({ users: results });
    }
  );
});

app.get("/me", requireAuth, (req, res) => {
  res.json({user: publicUser(req.user)});
});

app.post("/login", (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || '');

  db.query(
    "SELECT id, username, password_hash FROM users WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Login failed" });
      }

      if (results.length === 0) {
        return res.status(400).json({ message: "Invalid login" });
      }

      const user = results[0];

      const validPassword = await bcrypt.compare(
        password,
        user.password_hash
      );

      if (!validPassword) {
        return res.status(400).json({ message: "Invalid login" });
      }

      try {
        res.json({
          message: "Login successful",
          ...(await createAuthSession(user, req.headers['user-agent']))
        });
      } catch (sessionErr) {
        console.log("/login session error:", sessionErr);
        res.status(500).json({message: "Login failed"});
      }
    }
  );
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const refreshToken = req.body && req.body.refreshToken;
    const authSession = await rotateRefreshSession(refreshToken);

    res.json({message: "Session refreshed", ...authSession});
  } catch (err) {
    res.status(401).json({message: "Session expired"});
  }
});

app.post("/logout", async (req, res) => {
  try {
    const refreshToken = req.body && req.body.refreshToken;

    if (refreshToken) {
      await revokeRefreshSession(refreshToken);
    }

    res.json({message: "Logged out"});
  } catch (err) {
    res.json({message: "Logged out"});
  }
});

let channels = [];
let voiceChannels = [];

const voiceMembers = new Map();
const voiceChannelBySocket = new Map();

function voiceRoomName(channelId) {
  return `voice:${channelId}`;
}

function getTextChannel(channelId) {
  const id = parsePositiveInt(channelId, 0);
  return channels.find((channel) => channel.id === id);
}

function getVoiceChannel(channelId) {
  const id = parsePositiveInt(channelId, 0);
  return voiceChannels.find((channel) => channel.id === id);
}

function getVoiceMemberList(channelId) {
  const members = voiceMembers.get(channelId);
  if (!members) return [];
  return Array.from(members.values());
}

function getVoiceUsersByChannel() {
  const usersByChannel = {};

  voiceChannels.forEach((channel) => {
    usersByChannel[channel.id] = getVoiceMemberList(channel.id);
  });

  return usersByChannel;
}

function emitVoiceChannels() {
  io.emit('voice-channels', {
    channels: voiceChannels,
    usersByChannel: getVoiceUsersByChannel()
  });
}

function emitTextChannels() {
  io.emit('new-channel', {channels});
}

function emitVoiceUsers(channelId) {
  io.to(voiceRoomName(channelId)).emit('voice-users', {
    channelId,
    users: getVoiceMemberList(channelId)
  });
}

function sendVoiceError(socket, message) {
  socket.emit('voice-error', { message });
}

function leaveVoiceChannel(socket) {
  const channelId = voiceChannelBySocket.get(socket.id);
  if (!channelId) return;

  const members = voiceMembers.get(channelId);
  const member = members && members.get(socket.id);

  if (members) {
    members.delete(socket.id);

    if (members.size === 0) {
      voiceMembers.delete(channelId);
    }
  }

  voiceChannelBySocket.delete(socket.id);
  socket.leave(voiceRoomName(channelId));

  if (member) {
    socket.to(voiceRoomName(channelId)).emit('voice-user-left', {
      channelId,
      user: member
    });
  }

  emitVoiceUsers(channelId);
  emitVoiceChannels();
}

function removeVoiceChannelMembers(channelId) {
  const members = voiceMembers.get(channelId);
  if (!members) return;

  Array.from(members.keys()).forEach((socketId) => {
    const memberSocket = io.sockets.sockets.get(socketId);

    voiceChannelBySocket.delete(socketId);

    if (memberSocket) {
      sendVoiceError(memberSocket, 'Voice channel deleted');
      memberSocket.leave(voiceRoomName(channelId));
    }
  });

  voiceMembers.delete(channelId);
}

function areVoicePeersInSameChannel(senderSocketId, receiverSocketId, channelId) {
  const parsedChannelId = parsePositiveInt(channelId, 0);
  const members = voiceMembers.get(parsedChannelId);
  return Boolean(
    members &&
    members.has(senderSocketId) &&
    members.has(receiverSocketId)
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMessageRow(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username || 'anonymous',
    message: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at
  };
}

function normalizeUsername(username) {
  const trimmedUsername = String(username || '').trim();
  return (trimmedUsername || 'anonymous').slice(0, 50);
}

function validateChannelName(name) {
  const channelName = normalizeChannelName(name);

  if (!channelName || channelName.length > 50) {
    return null;
  }

  return channelName;
}

function isDuplicateEntryError(err) {
  return err && err.code === 'ER_DUP_ENTRY';
}

function getDuplicateChannelName(channelList, baseName) {
  const existingNames = new Set(channelList.map((channel) => channelNameKey(channel.name)));
  const fallbackName = normalizeChannelName(baseName) || 'channel';

  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidateBase = fallbackName.slice(0, 50 - suffix.length).trim();
    const candidate = `${candidateBase}${suffix}`;

    if (candidateBase && !existingNames.has(channelNameKey(candidate))) {
      return candidate;
    }
  }

  return null;
}

function loadChannelMessages(channelId, callback) {
  db.query(
    "SELECT id, channel_id, user_id, username, body, created_at, edited_at FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?",
    [channelId, MESSAGE_HISTORY_LIMIT],
    (err, results) => {
      if (err) {
        console.log("/messages SELECT error:", err);
        callback(err);
        return;
      }

      callback(null, results.reverse().map(normalizeMessageRow));
    }
  );
}

async function getMessageById(messageId) {
  const rows = await dbQuery(
    "SELECT id, channel_id, user_id, username, body, created_at, edited_at FROM messages WHERE id = ? LIMIT 1",
    [messageId]
  );

  return rows[0] || null;
}

function sendSocketAuthError(socket, callback) {
  if (typeof callback === 'function') {
    callback({success: false, error: 'Session expired'});
  }

  socket.disconnect(true);
}

function getSocketUser(socket, callback) {
  if (!socket.user || socket.user.tokenExpiresAt <= Date.now()) {
    sendSocketAuthError(socket, callback);
    return null;
  }

  return socket.user;
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    socket.user = await getUserFromAccessToken(token);
    next();
  } catch (err) {
    next(new Error('Authentication required'));
  }
});

io.on('connection', (socket) => {
  socket.emit('new-channel', {channels});
  socket.emit('voice-channels', {
    channels: voiceChannels,
    usersByChannel: getVoiceUsersByChannel()
  });

  socket.on('create-channel', async (name, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelName = validateChannelName(name);

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Invalid channel name'});
      return;
    }

    try {
      const result = await dbQuery(
        "INSERT INTO channels (name, name_key) VALUES (?, ?)",
        [channelName, channelNameKey(channelName)]
      );
      await loadChannelCaches();

      const newChannel = channels.find((channel) => channel.id === result.insertId) || {
        id: result.insertId,
        name: channelName
      };

      emitTextChannels();
      if (typeof callback === 'function') callback({success: true, channel: newChannel});
    } catch (err) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: isDuplicateEntryError(err) ? 'Channel already exists' : 'Could not create channel'
        });
      }

      if (!isDuplicateEntryError(err)) {
        console.log("/channels INSERT error:", err);
      }
    }
  });

  socket.on('edit-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);
    const channelName = validateChannelName(data && data.name);

    if (!getTextChannel(channelId)) {
      if (typeof callback === 'function') callback({success: false, error: 'Channel not found'});
      return;
    }

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Invalid channel name'});
      return;
    }

    try {
      await dbQuery(
        "UPDATE channels SET name = ?, name_key = ? WHERE id = ?",
        [channelName, channelNameKey(channelName), channelId]
      );
      await loadChannelCaches();
      emitTextChannels();

      if (typeof callback === 'function') {
        callback({success: true, channel: getTextChannel(channelId)});
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: isDuplicateEntryError(err) ? 'Channel already exists' : 'Could not edit channel'
        });
      }

      if (!isDuplicateEntryError(err)) {
        console.log("/channels UPDATE error:", err);
      }
    }
  });

  socket.on('duplicate-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);
    const sourceChannel = getTextChannel(channelId);

    if (!sourceChannel) {
      if (typeof callback === 'function') callback({success: false, error: 'Channel not found'});
      return;
    }

    const channelName = getDuplicateChannelName(channels, sourceChannel.name);

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not duplicate channel'});
      return;
    }

    try {
      const result = await dbQuery(
        "INSERT INTO channels (name, name_key) VALUES (?, ?)",
        [channelName, channelNameKey(channelName)]
      );
      await loadChannelCaches();

      const newChannel = getTextChannel(result.insertId) || {
        id: result.insertId,
        name: channelName
      };

      emitTextChannels();
      if (typeof callback === 'function') callback({success: true, channel: newChannel});
    } catch (err) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not duplicate channel'});
      console.log("/channels duplicate error:", err);
    }
  });

  socket.on('delete-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);

    if (!getTextChannel(channelId)) {
      if (typeof callback === 'function') callback({success: false, error: 'Channel not found'});
      return;
    }

    if (channels.length <= 1) {
      if (typeof callback === 'function') callback({success: false, error: 'Keep at least one text channel'});
      return;
    }

    try {
      await dbQuery("DELETE FROM messages WHERE channel_id = ?", [channelId]);
      await dbQuery("DELETE FROM channels WHERE id = ?", [channelId]);
      await loadChannelCaches();
      emitTextChannels();

      if (typeof callback === 'function') callback({success: true});
    } catch (err) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not delete channel'});
      console.log("/channels DELETE error:", err);
    }
  });

  socket.on('load messages', (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, DEFAULT_CHANNEL_ID);

    if (!getTextChannel(channelId)) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: 'Channel not found',
          messages: [],
          limit: MESSAGE_HISTORY_LIMIT
        });
      }
      return;
    }

    loadChannelMessages(channelId, (err, messages) => {
      if (typeof callback !== 'function') return;

      if (err) {
        callback({
          success: false,
          error: 'Could not load messages',
          messages: [],
          limit: MESSAGE_HISTORY_LIMIT
        });
        return;
      }

      callback({
        success: true,
        messages,
        limit: MESSAGE_HISTORY_LIMIT
      });
    });
  });

  socket.on('chat message', (data, callback) => {
    const user = getSocketUser(socket, callback);
    if (!user) return;

    const channelId = parsePositiveInt(data && data.channelId, DEFAULT_CHANNEL_ID);
    const body = String((data && data.message) || '').trim();

    if (!getTextChannel(channelId)) {
      if (typeof callback === 'function') {
        callback({success: false, error: 'Channel not found'});
      }
      return;
    }

    if (!body) {
      if (typeof callback === 'function') {
        callback({success: false, error: 'Message cannot be empty'});
      }
      return;
    }

    db.query(
      "INSERT INTO messages (channel_id, user_id, username, body) VALUES (?, ?, ?, ?)",
      [channelId, user.id, user.username, body],
      (err, result) => {
        if (err) {
          console.log("/messages INSERT error:", err);
          if (typeof callback === 'function') {
            callback({success: false, error: 'Message could not be saved'});
          }
          return;
        }

        const savedMessage = {
          id: result.insertId,
          channelId,
          userId: user.id,
          username: user.username,
          message: body,
          createdAt: new Date().toISOString(),
          editedAt: null
        };

        io.emit('chat message', savedMessage);

        if (typeof callback === 'function') {
          callback({success: true, message: savedMessage});
        }
      }
    );
  });

  socket.on('edit-message', async (data, callback) => {
    const user = getSocketUser(socket, callback);
    if (!user) return;

    const messageId = parsePositiveInt(data && data.messageId, 0);
    const body = String((data && data.message) || '').trim();

    if (!messageId) {
      if (typeof callback === 'function') callback({success: false, error: 'Message not found'});
      return;
    }

    if (!body) {
      if (typeof callback === 'function') callback({success: false, error: 'Message cannot be empty'});
      return;
    }

    try {
      const existingMessage = await getMessageById(messageId);

      if (!existingMessage) {
        if (typeof callback === 'function') callback({success: false, error: 'Message not found'});
        return;
      }

      if (String(existingMessage.user_id) !== String(user.id)) {
        if (typeof callback === 'function') callback({success: false, error: 'You can only edit your messages'});
        return;
      }

      await dbQuery(
        "UPDATE messages SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?",
        [body, messageId, user.id]
      );

      const updatedMessage = normalizeMessageRow(await getMessageById(messageId));
      io.emit('message-edited', updatedMessage);

      if (typeof callback === 'function') {
        callback({success: true, message: updatedMessage});
      }
    } catch (err) {
      console.log("/messages UPDATE error:", err);
      if (typeof callback === 'function') callback({success: false, error: 'Could not edit message'});
    }
  });

  socket.on('delete-message', async (data, callback) => {
    const user = getSocketUser(socket, callback);
    if (!user) return;

    const messageId = parsePositiveInt(data && data.messageId, 0);

    if (!messageId) {
      if (typeof callback === 'function') callback({success: false, error: 'Message not found'});
      return;
    }

    try {
      const existingMessage = await getMessageById(messageId);

      if (!existingMessage) {
        if (typeof callback === 'function') callback({success: false, error: 'Message not found'});
        return;
      }

      if (String(existingMessage.user_id) !== String(user.id)) {
        if (typeof callback === 'function') callback({success: false, error: 'You can only delete your messages'});
        return;
      }

      await dbQuery("DELETE FROM messages WHERE id = ? AND user_id = ?", [messageId, user.id]);

      io.emit('message-deleted', {
        id: messageId,
        channelId: existingMessage.channel_id
      });

      if (typeof callback === 'function') callback({success: true});
    } catch (err) {
      console.log("/messages DELETE error:", err);
      if (typeof callback === 'function') callback({success: false, error: 'Could not delete message'});
    }
  });

  socket.on('create-voice-channel', async (name, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelName = validateChannelName(name);

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Invalid voice channel name'});
      return;
    }

    try {
      const result = await dbQuery(
        "INSERT INTO voice_channels (name, name_key) VALUES (?, ?)",
        [channelName, channelNameKey(channelName)]
      );
      voiceChannels = await loadVoiceChannelsFromDb();

      const newChannel = voiceChannels.find((channel) => channel.id === result.insertId) || {
        id: result.insertId,
        name: channelName
      };

      emitVoiceChannels();
      if (typeof callback === 'function') callback({success: true, channel: newChannel});
    } catch (err) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: isDuplicateEntryError(err) ? 'Voice channel already exists' : 'Could not create voice channel'
        });
      }

      if (!isDuplicateEntryError(err)) {
        console.log("/voice_channels INSERT error:", err);
      }
    }
  });

  socket.on('edit-voice-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);
    const channelName = validateChannelName(data && data.name);

    if (!getVoiceChannel(channelId)) {
      if (typeof callback === 'function') callback({success: false, error: 'Voice channel not found'});
      return;
    }

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Invalid voice channel name'});
      return;
    }

    try {
      await dbQuery(
        "UPDATE voice_channels SET name = ?, name_key = ? WHERE id = ?",
        [channelName, channelNameKey(channelName), channelId]
      );
      voiceChannels = await loadVoiceChannelsFromDb();
      emitVoiceChannels();

      if (typeof callback === 'function') {
        callback({success: true, channel: getVoiceChannel(channelId)});
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback({
          success: false,
          error: isDuplicateEntryError(err) ? 'Voice channel already exists' : 'Could not edit voice channel'
        });
      }

      if (!isDuplicateEntryError(err)) {
        console.log("/voice_channels UPDATE error:", err);
      }
    }
  });

  socket.on('duplicate-voice-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);
    const sourceChannel = getVoiceChannel(channelId);

    if (!sourceChannel) {
      if (typeof callback === 'function') callback({success: false, error: 'Voice channel not found'});
      return;
    }

    const channelName = getDuplicateChannelName(voiceChannels, sourceChannel.name);

    if (!channelName) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not duplicate voice channel'});
      return;
    }

    try {
      const result = await dbQuery(
        "INSERT INTO voice_channels (name, name_key) VALUES (?, ?)",
        [channelName, channelNameKey(channelName)]
      );
      voiceChannels = await loadVoiceChannelsFromDb();

      const newChannel = getVoiceChannel(result.insertId) || {
        id: result.insertId,
        name: channelName
      };

      emitVoiceChannels();
      if (typeof callback === 'function') callback({success: true, channel: newChannel});
    } catch (err) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not duplicate voice channel'});
      console.log("/voice_channels duplicate error:", err);
    }
  });

  socket.on('delete-voice-channel', async (data, callback) => {
    if (!getSocketUser(socket, callback)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);

    if (!getVoiceChannel(channelId)) {
      if (typeof callback === 'function') callback({success: false, error: 'Voice channel not found'});
      return;
    }

    if (voiceChannels.length <= 1) {
      if (typeof callback === 'function') callback({success: false, error: 'Keep at least one voice channel'});
      return;
    }

    try {
      await dbQuery("DELETE FROM voice_channels WHERE id = ?", [channelId]);
      removeVoiceChannelMembers(channelId);
      voiceChannels = await loadVoiceChannelsFromDb();
      emitVoiceChannels();

      if (typeof callback === 'function') callback({success: true});
    } catch (err) {
      if (typeof callback === 'function') callback({success: false, error: 'Could not delete voice channel'});
      console.log("/voice_channels DELETE error:", err);
    }
  });

  socket.on('join-voice', (data, callback) => {
    const authUser = getSocketUser(socket, callback);
    if (!authUser) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);
    const channel = getVoiceChannel(channelId);

    if (!channel) {
      const error = 'Voice channel not found';
      sendVoiceError(socket, error);
      if (typeof callback === 'function') callback({success: false, error});
      return;
    }

    const existingChannelId = voiceChannelBySocket.get(socket.id);
    if (existingChannelId === channelId) {
      if (typeof callback === 'function') {
        callback({
          success: true,
          channel,
          socketId: socket.id,
          users: getVoiceMemberList(channelId).filter((user) => user.socketId !== socket.id)
        });
      }
      return;
    }

    leaveVoiceChannel(socket);

    const existingUsers = getVoiceMemberList(channelId);
    const member = {
      socketId: socket.id,
      userId: authUser.id,
      username: authUser.username
    };

    if (!voiceMembers.has(channelId)) {
      voiceMembers.set(channelId, new Map());
    }

    voiceMembers.get(channelId).set(socket.id, member);
    voiceChannelBySocket.set(socket.id, channelId);
    socket.join(voiceRoomName(channelId));

    socket.to(voiceRoomName(channelId)).emit('voice-user-joined', {
      channelId,
      user: member
    });

    emitVoiceUsers(channelId);
    emitVoiceChannels();

    if (typeof callback === 'function') {
      callback({
        success: true,
        channel,
        socketId: socket.id,
        users: existingUsers
      });
    }
  });

  socket.on('leave-voice', (callback) => {
    leaveVoiceChannel(socket);

    if (typeof callback === 'function') {
      callback({success: true});
    }
  });

  socket.on('voice-offer', (data) => {
    if (!getSocketUser(socket)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);

    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, channelId)) {
      sendVoiceError(socket, 'Cannot send voice offer');
      return;
    }

    io.to(data.to).emit('voice-offer', {
      channelId,
      from: socket.id,
      user: voiceMembers.get(channelId).get(socket.id),
      offer: data.offer
    });
  });

  socket.on('voice-answer', (data) => {
    if (!getSocketUser(socket)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);

    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, channelId)) {
      sendVoiceError(socket, 'Cannot send voice answer');
      return;
    }

    io.to(data.to).emit('voice-answer', {
      channelId,
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on('voice-ice-candidate', (data) => {
    if (!getSocketUser(socket)) return;

    const channelId = parsePositiveInt(data && data.channelId, 0);

    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, channelId)) {
      return;
    }

    io.to(data.to).emit('voice-ice-candidate', {
      channelId,
      from: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnect', () => {
    leaveVoiceChannel(socket);
  });
});

db.connect((err) => {
  if (err) {
    console.log("Database connection failed");
    console.log(err);
    return;
  }

  console.log("Connected to MySQL");

  initializeDatabase()
    .then(() => {
      console.log("Database tables ready");
      server.listen(port, () => {
        console.log('Chat server running on http://localhost:3000');
        console.log(`Web server listening on port ${port}`);
      });
    })
    .catch((tableErr) => {
      console.log("Could not initialize database tables");
      console.log(tableErr);
      process.exitCode = 1;
      db.end();
    });
});
