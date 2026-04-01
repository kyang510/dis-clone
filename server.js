const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

io.on('connection', (socket) => {
  socket.on('chat message', (data) => {
    io.emit('chat message', data);
  });
});

server.listen(port, () => {
  console.log('Chat server running on http://localhost:3000');
      console.log(`Web server listening on port ${port}`);
});
