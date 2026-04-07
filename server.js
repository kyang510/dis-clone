const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

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
