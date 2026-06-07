const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});
const port = 3000;

const cors = require("cors");
const bcrypt = require("bcrypt");
const mysql = require('mysql2');

app.use(cors());
app.use(express.json());


// MySQL database connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  database: "mywebsite",
  password: "joshsucks",
  port: 3306,
});

db.connect((err) => {
  if (err) {
    console.log("Database connection failed");
    console.log(err);
    return;
  }

  console.log("Connected to MySQL");
});

app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  const passwordHash = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email, passwordHash],
    (err, result) => {
      if (err) {
        console.log("/signup INSERT error:", err);
        return res.status(500).json({ message: "Signup failed", error: err.message });
      }


      res.json({ message: "Account created" });
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ?",
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

      res.json({
        message: "Login successful",
        userId: user.id,
        username: user.username
      });
    }
  );
});

// In-memory channel storage
let channels = [
  {id: 1, name: 'general'},
  {id: 2, name: 'memes'},
  {id: 3, name: 'gaming'},
  {id: 4, name: 'music'}
];

let voiceChannels = [
  {id: 1, name: 'general'},
  {id: 2, name: 'memes'},
  {id: 3, name: 'gaming'},
  {id: 4, name: 'music'}
];

const voiceMembers = new Map();
const voiceChannelBySocket = new Map();

function voiceRoomName(channelId) {
  return `voice:${channelId}`;
}

function getVoiceChannel(channelId) {
  return voiceChannels.find((channel) => channel.id === channelId);
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

function areVoicePeersInSameChannel(senderSocketId, receiverSocketId, channelId) {
  const members = voiceMembers.get(channelId);
  return Boolean(
    members &&
    members.has(senderSocketId) &&
    members.has(receiverSocketId)
  );
}

io.on('connection', (socket) => {
  socket.emit('new-channel', {channels});
  socket.emit('voice-channels', {
    channels: voiceChannels,
    usersByChannel: getVoiceUsersByChannel()
  });

  socket.on('create-channel', (name, callback) => {
    if (!name || name.trim().length < 1 || name.trim().length > 50) {
      callback({success: false, error: 'Invalid channel name'});
      return;
    }
    const channelName = name.trim();
    if (channels.find(c => c.name.toLowerCase() === channelName.toLowerCase())) {
      callback({success: false, error: 'Channel already exists'});
      return;
    }
    const newChannel = {
      id: Date.now(), 
      name: channelName
    };
    channels.push(newChannel);
    io.emit('new-channel', {channels});
    callback({success: true, channel: newChannel});
  });

  socket.on('chat message', (data) => {
    if (!data.channelId) {
      data.channelId = 1; 
    }
    io.emit('chat message', data);
  });

  socket.on('create-voice-channel', (name, callback) => {
    if (!name || name.trim().length < 1 || name.trim().length > 50) {
      callback({success: false, error: 'Invalid voice channel name'});
      return;
    }

    const channelName = name.trim();

    if (voiceChannels.find(c => c.name.toLowerCase() === channelName.toLowerCase())) {
      callback({success: false, error: 'Voice channel already exists'});
      return;
    }

    const newChannel = {
      id: Date.now(),
      name: channelName
    };

    voiceChannels.push(newChannel);
    emitVoiceChannels();
    callback({success: true, channel: newChannel});
  });

  socket.on('join-voice', (data, callback) => {
    const channelId = data && data.channelId;
    const userId = data && data.userId;
    const username = data && data.username;

    if (!userId || !username) {
      const error = 'Log in before joining voice';
      sendVoiceError(socket, error);
      if (typeof callback === 'function') callback({success: false, error});
      return;
    }

    if (!getVoiceChannel(channelId)) {
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
          channel: getVoiceChannel(channelId),
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
      userId,
      username
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
        channel: getVoiceChannel(channelId),
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
    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, data.channelId)) {
      sendVoiceError(socket, 'Cannot send voice offer');
      return;
    }

    io.to(data.to).emit('voice-offer', {
      channelId: data.channelId,
      from: socket.id,
      user: voiceMembers.get(data.channelId).get(socket.id),
      offer: data.offer
    });
  });

  socket.on('voice-answer', (data) => {
    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, data.channelId)) {
      sendVoiceError(socket, 'Cannot send voice answer');
      return;
    }

    io.to(data.to).emit('voice-answer', {
      channelId: data.channelId,
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on('voice-ice-candidate', (data) => {
    if (!data || !areVoicePeersInSameChannel(socket.id, data.to, data.channelId)) {
      return;
    }

    io.to(data.to).emit('voice-ice-candidate', {
      channelId: data.channelId,
      from: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('disconnect', () => {
    leaveVoiceChannel(socket);
  });
});

server.listen(port, () => {
  console.log('Chat server running on http://localhost:3000');
      console.log(`Web server listening on port ${port}`);
});
