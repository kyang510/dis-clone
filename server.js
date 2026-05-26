const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
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

io.on('connection', (socket) => {
  socket.emit('new-channel', {channels});

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
});

server.listen(port, () => {
  console.log('Chat server running on http://localhost:3000');
      console.log(`Web server listening on port ${port}`);
});
