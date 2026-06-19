const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('node:crypto');
const path = require('path');

function isAllowedOrigin(origin) {
  return !origin || origin === 'null' || origin.startsWith('file://') || origin === 'http://localhost:3000';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 40 * 1024 * 1024,
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin))
  }
});
const port = 3000;
const DEFAULT_CHANNEL_ID = 1;
const MESSAGE_HISTORY_LIMIT = 100;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const allowedAttachmentMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'audio/mpeg',
  'audio/mp3'
]);
const attachmentMimeByExtension = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'],
  ['.mp3', 'audio/mpeg']
]);
const MESSAGE_SELECT_COLUMNS = [
  'id',
  'channel_id',
  'user_id',
  'username',
  'body',
  'attachment_name',
  'attachment_mime',
  'attachment_size',
  'attachment_data',
  'created_at',
  'edited_at'
].join(', ');
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

const bcrypt = require("bcrypt");
const mysql = require('mysql2');

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin) && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
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

async function addColumnIfMissing(tableName, columnName, columnDefinition) {
  try {
    await dbQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  } catch (err) {
    if (!err || err.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }
}

async function ensureMessagesTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id INT NOT NULL,
      user_id INT NOT NULL,
      username VARCHAR(50) NOT NULL,
      body TEXT NOT NULL,
      attachment_name VARCHAR(255) NULL,
      attachment_mime VARCHAR(100) NULL,
      attachment_size INT UNSIGNED NULL,
      attachment_data LONGBLOB NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMP NULL,
      INDEX idx_messages_channel_id_id (channel_id, id),
      INDEX idx_messages_user_id (user_id),
      CONSTRAINT fk_messages_channel_id FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      CONSTRAINT fk_messages_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await addColumnIfMissing('messages', 'edited_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('messages', 'attachment_name', 'VARCHAR(255) NULL');
  await addColumnIfMissing('messages', 'attachment_mime', 'VARCHAR(100) NULL');
  await addColumnIfMissing('messages', 'attachment_size', 'INT UNSIGNED NULL');
  await addColumnIfMissing('messages', 'attachment_data', 'LONGBLOB NULL');
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

async function createAuthSession(user, userAgent) {
  const sessionId = crypto.randomUUID();
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const sessionExpiresAt = new Date(Date.now() + SESSION_TOKEN_TTL_SECONDS * 1000);

  await dbQuery(
    "INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
    [
      sessionId,
      user.id,
      hashToken(sessionToken),
      String(userAgent || '').slice(0, 255),
      toMysqlDate(sessionExpiresAt)
    ]
  );

  return {
    sessionToken,
    user: publicUser(user)
  };
}

async function getUserFromSessionToken(token) {
  const rows = await dbQuery(
    `SELECT sessions.id, sessions.user_id, users.username
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.refresh_token_hash = ?
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [hashToken(token)]
  );
  const session = rows[0];

  if (!session) {
    throw new Error('Invalid session');
  }

  await dbQuery("UPDATE sessions SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [session.id]);

  return {
    id: session.user_id,
    username: session.username,
    sessionId: session.id
  };
}

async function revokeAuthSession(sessionToken) {
  await dbQuery(
    "UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE refresh_token_hash = ?",
    [hashToken(sessionToken)]
  );
}

async function requireAuth(req, res, next) {
  try {
    req.user = await getUserFromSessionToken(getBearerToken(req));
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



app.post("/logout", async (req, res) => {
  try {
    const sessionToken = getBearerToken(req) || (req.body && req.body.sessionToken);

    if (sessionToken) {
      await revokeAuthSession(sessionToken);
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

function normalizeAttachmentName(name) {
  const cleanedName = String(name || 'attachment')
    .replace(/[\\/\0]/g, '')
    .trim()
    .slice(0, 255);

  return cleanedName || 'attachment';
}

function normalizeAttachmentMime(name, mime) {
  const normalizedMime = String(mime || '').trim().toLowerCase().split(';')[0];

  if (allowedAttachmentMimeTypes.has(normalizedMime)) {
    return normalizedMime === 'audio/mp3' ? 'audio/mpeg' : normalizedMime;
  }

  return attachmentMimeByExtension.get(path.extname(name).toLowerCase()) || null;
}

function normalizeAttachmentBuffer(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  return null;
}

function parseAttachmentPayload(attachment) {
  if (!attachment) {
    return {attachment: null};
  }

  const name = normalizeAttachmentName(attachment.name);
  const mime = normalizeAttachmentMime(name, attachment.type || attachment.mime);
  const data = normalizeAttachmentBuffer(attachment.data);

  if (!mime) {
    return {error: 'Only images, GIFs, MP4, and MP3 files are allowed'};
  }

  if (!data || data.length === 0) {
    return {error: 'Attachment is empty'};
  }

  if (data.length > MAX_ATTACHMENT_BYTES) {
    return {error: 'Attachment is too large'};
  }

  return {
    attachment: {
      name,
      mime,
      size: data.length,
      data
    }
  };
}

function normalizeMessageAttachment(row) {
  if (!row.attachment_data || !row.attachment_mime) {
    return null;
  }

  return {
    name: row.attachment_name || 'attachment',
    type: row.attachment_mime,
    size: Number(row.attachment_size) || row.attachment_data.length,
    data: row.attachment_data.toString('base64')
  };
}

function normalizeMessageRow(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username || 'anonymous',
    message: row.body,
    attachment: normalizeMessageAttachment(row),
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
    `SELECT ${MESSAGE_SELECT_COLUMNS} FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?`,
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
    `SELECT ${MESSAGE_SELECT_COLUMNS} FROM messages WHERE id = ? LIMIT 1`,
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
  if (!socket.user) {
    sendSocketAuthError(socket, callback);
    return null;
  }

  return socket.user;
}

function reply(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

const channelKinds = {
  text: {
    table: 'channels',
    list: () => channels,
    find: getTextChannel,
    reload: loadChannelCaches,
    emit: emitTextChannels,
    logName: '/channels',
    invalidName: 'Invalid channel name',
    notFound: 'Channel not found',
    alreadyExists: 'Channel already exists',
    createFailed: 'Could not create channel',
    editFailed: 'Could not edit channel',
    duplicateFailed: 'Could not duplicate channel',
    deleteFailed: 'Could not delete channel',
    keepOne: 'Keep at least one text channel',
    beforeDelete: (channelId) => dbQuery("DELETE FROM messages WHERE channel_id = ?", [channelId]),
    afterDelete: async () => {}
  },
  voice: {
    table: 'voice_channels',
    list: () => voiceChannels,
    find: getVoiceChannel,
    reload: async () => {
      voiceChannels = await loadVoiceChannelsFromDb();
    },
    emit: emitVoiceChannels,
    logName: '/voice_channels',
    invalidName: 'Invalid voice channel name',
    notFound: 'Voice channel not found',
    alreadyExists: 'Voice channel already exists',
    createFailed: 'Could not create voice channel',
    editFailed: 'Could not edit voice channel',
    duplicateFailed: 'Could not duplicate voice channel',
    deleteFailed: 'Could not delete voice channel',
    keepOne: 'Keep at least one voice channel',
    beforeDelete: async () => {},
    afterDelete: async (channelId) => removeVoiceChannelMembers(channelId)
  }
};

async function createChannel(socket, kind, name, callback) {
  if (!getSocketUser(socket, callback)) return;

  const channelName = validateChannelName(name);

  if (!channelName) {
    reply(callback, {success: false, error: kind.invalidName});
    return;
  }

  try {
    const result = await dbQuery(
      `INSERT INTO ${kind.table} (name, name_key) VALUES (?, ?)`,
      [channelName, channelNameKey(channelName)]
    );
    await kind.reload();

    const newChannel = kind.find(result.insertId) || {
      id: result.insertId,
      name: channelName
    };

    kind.emit();
    reply(callback, {success: true, channel: newChannel});
  } catch (err) {
    reply(callback, {
      success: false,
      error: isDuplicateEntryError(err) ? kind.alreadyExists : kind.createFailed
    });

    if (!isDuplicateEntryError(err)) {
      console.log(`${kind.logName} INSERT error:`, err);
    }
  }
}

async function editChannel(socket, kind, data, callback) {
  if (!getSocketUser(socket, callback)) return;

  const channelId = parsePositiveInt(data && data.channelId, 0);
  const channelName = validateChannelName(data && data.name);

  if (!kind.find(channelId)) {
    reply(callback, {success: false, error: kind.notFound});
    return;
  }

  if (!channelName) {
    reply(callback, {success: false, error: kind.invalidName});
    return;
  }

  try {
    await dbQuery(
      `UPDATE ${kind.table} SET name = ?, name_key = ? WHERE id = ?`,
      [channelName, channelNameKey(channelName), channelId]
    );
    await kind.reload();
    kind.emit();
    reply(callback, {success: true, channel: kind.find(channelId)});
  } catch (err) {
    reply(callback, {
      success: false,
      error: isDuplicateEntryError(err) ? kind.alreadyExists : kind.editFailed
    });

    if (!isDuplicateEntryError(err)) {
      console.log(`${kind.logName} UPDATE error:`, err);
    }
  }
}

async function duplicateChannel(socket, kind, data, callback) {
  if (!getSocketUser(socket, callback)) return;

  const channelId = parsePositiveInt(data && data.channelId, 0);
  const sourceChannel = kind.find(channelId);

  if (!sourceChannel) {
    reply(callback, {success: false, error: kind.notFound});
    return;
  }

  const channelName = getDuplicateChannelName(kind.list(), sourceChannel.name);

  if (!channelName) {
    reply(callback, {success: false, error: kind.duplicateFailed});
    return;
  }

  try {
    const result = await dbQuery(
      `INSERT INTO ${kind.table} (name, name_key) VALUES (?, ?)`,
      [channelName, channelNameKey(channelName)]
    );
    await kind.reload();

    const newChannel = kind.find(result.insertId) || {
      id: result.insertId,
      name: channelName
    };

    kind.emit();
    reply(callback, {success: true, channel: newChannel});
  } catch (err) {
    reply(callback, {success: false, error: kind.duplicateFailed});
    console.log(`${kind.logName} duplicate error:`, err);
  }
}

async function deleteChannel(socket, kind, data, callback) {
  if (!getSocketUser(socket, callback)) return;

  const channelId = parsePositiveInt(data && data.channelId, 0);

  if (!kind.find(channelId)) {
    reply(callback, {success: false, error: kind.notFound});
    return;
  }

  if (kind.list().length <= 1) {
    reply(callback, {success: false, error: kind.keepOne});
    return;
  }

  try {
    await kind.beforeDelete(channelId);
    await dbQuery(`DELETE FROM ${kind.table} WHERE id = ?`, [channelId]);
    await kind.afterDelete(channelId);
    await kind.reload();
    kind.emit();
    reply(callback, {success: true});
  } catch (err) {
    reply(callback, {success: false, error: kind.deleteFailed});
    console.log(`${kind.logName} DELETE error:`, err);
  }
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    socket.user = await getUserFromSessionToken(token);
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

  socket.on('create-channel', (name, callback) => createChannel(socket, channelKinds.text, name, callback));
  socket.on('edit-channel', (data, callback) => editChannel(socket, channelKinds.text, data, callback));
  socket.on('duplicate-channel', (data, callback) => duplicateChannel(socket, channelKinds.text, data, callback));
  socket.on('delete-channel', (data, callback) => deleteChannel(socket, channelKinds.text, data, callback));

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

  socket.on('chat message', async (data, callback) => {
    const user = getSocketUser(socket, callback);
    if (!user) return;

    const channelId = parsePositiveInt(data && data.channelId, DEFAULT_CHANNEL_ID);
    const body = String((data && data.message) || '').trim();
    const attachmentResult = parseAttachmentPayload(data && data.attachment);

    if (!getTextChannel(channelId)) {
      if (typeof callback === 'function') {
        callback({success: false, error: 'Channel not found'});
      }
      return;
    }

    if (attachmentResult.error) {
      if (typeof callback === 'function') {
        callback({success: false, error: attachmentResult.error});
      }
      return;
    }

    const attachment = attachmentResult.attachment;

    if (!body && !attachment) {
      if (typeof callback === 'function') {
        callback({success: false, error: 'Message cannot be empty'});
      }
      return;
    }

    try {
      const result = await dbQuery(
        `INSERT INTO messages (
          channel_id,
          user_id,
          username,
          body,
          attachment_name,
          attachment_mime,
          attachment_size,
          attachment_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          channelId,
          user.id,
          user.username,
          body,
          attachment && attachment.name,
          attachment && attachment.mime,
          attachment && attachment.size,
          attachment && attachment.data
        ]
      );

      const savedMessage = normalizeMessageRow(await getMessageById(result.insertId));
      io.emit('chat message', savedMessage);

      if (typeof callback === 'function') {
        callback({success: true, message: savedMessage});
      }
    } catch (err) {
      console.log("/messages INSERT error:", err);
      if (typeof callback === 'function') {
        callback({success: false, error: 'Message could not be saved'});
      }
    }
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

      if (!body && !existingMessage.attachment_data) {
        if (typeof callback === 'function') callback({success: false, error: 'Message cannot be empty'});
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

  socket.on('create-voice-channel', (name, callback) => createChannel(socket, channelKinds.voice, name, callback));
  socket.on('edit-voice-channel', (data, callback) => editChannel(socket, channelKinds.voice, data, callback));
  socket.on('duplicate-voice-channel', (data, callback) => duplicateChannel(socket, channelKinds.voice, data, callback));
  socket.on('delete-voice-channel', (data, callback) => deleteChannel(socket, channelKinds.voice, data, callback));

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
