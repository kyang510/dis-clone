const information = document.getElementById('info');
information.innerText = `This app is using Chrome (v${window.versions.chrome()}), Node.js (v${window.versions.node()}), and Electron (v${window.versions.electron()})`;

let message;

const form = document.getElementById('form');
const messageInput = document.getElementById('message');
const messageArea = document.getElementById('messageArea');

let currentChannelId = 1;

// Create Channel modal
const modal = document.getElementById('channel-modal');
const channelInput = document.getElementById('channel-name-input');
const addBtn = document.getElementById('add-channel-btn');
const confirmBtn = document.getElementById('create-channel-confirm');
const cancelBtn = document.getElementById('create-channel-cancel');

// hidden on startup
modal.style.display = 'none';

addBtn.onclick = () => {
  modal.style.display = 'flex';
  channelInput.value = '';
  channelInput.focus();
};

cancelBtn.onclick = () => {
  modal.style.display = 'none';
};

confirmBtn.onclick = () => {
  const name = channelInput.value.trim();
  if (!name) return;

  window.chatAPI.sendChannel(name, (res) => {
    if (res.success) {
      modal.style.display = 'none';
      channelInput.value = '';
    } else {
      alert(res.error || 'Error creating channel');
    }
  });
};

function switchChannel(channelId) {
  currentChannelId = channelId;
  document.querySelectorAll('.channel').forEach((c) => c.classList.remove('active'));

  const activeEl = document.querySelector(`[data-channel-id="${channelId}"]`);
  if (activeEl) activeEl.classList.add('active');

  messageArea.innerHTML = '';
}

function renderChannels(data) {
  const container = document.getElementById('dynamic-channels');
  container.innerHTML = '';

  data.channels.forEach((channel) => {
    const channelEl = document.createElement('div');
    channelEl.className = 'channel';

    if (channel.id == currentChannelId) channelEl.classList.add('active');

    channelEl.textContent = `# ${channel.name}`;
    channelEl.dataset.channelId = channel.id;
    channelEl.onclick = () => switchChannel(channel.id);

    container.appendChild(channelEl);
  });
}

window.chatAPI.onNewChannel(renderChannels);

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const messageText = messageInput.value.trim();
  if (!messageText) return;

  window.chatAPI.sendMessage({
    username: currentUsername,
    message: messageText,
    channelId: currentChannelId
  });

  messageInput.value = '';
});



// chat messages
window.chatAPI.onMessage((data) => {
  if (data.channelId && parseInt(data.channelId) !== currentChannelId) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-placeholder';

  const username = data.username || 'anonymous';

  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'username-placeholder';
  usernameSpan.textContent = `${username}: `;

  const textSpan = document.createElement('span');
  textSpan.className = 'text';
  textSpan.textContent = data.message;

  messageDiv.appendChild(usernameSpan);
  messageDiv.appendChild(textSpan);
  messageArea.appendChild(messageDiv);
  messageArea.scrollTop = messageArea.scrollHeight;

  messageInput.value = '';
});

// Voice channels
const voiceModal = document.getElementById('voice-channel-modal');
const voiceChannelInput = document.getElementById('voice-channel-name-input');
const addVoiceBtn = document.getElementById('add-voice-channel-btn');
const confirmVoiceBtn = document.getElementById('create-voice-channel-confirm');
const cancelVoiceBtn = document.getElementById('create-voice-channel-cancel');
const voiceChannelsContainer = document.getElementById('dynamic-voice-channels');
const voiceStatusLabel = document.querySelector('.voice-status-label');
const voiceStatusChannel = document.getElementById('voice-status-channel');
const muteVoiceBtn = document.getElementById('mute-voice-btn');
const deafenVoiceBtn = document.getElementById('deafen-voice-btn');
const leaveVoiceBtn = document.getElementById('leave-voice-btn');
const remoteAudioContainer = document.getElementById('remote-audio-container');

let voiceChannels = [];
let voiceUsersByChannel = {};
let currentVoiceChannelId = null;
let currentVoiceChannelName = '';
let currentVoiceSocketId = null;
let localStream = null;
let isVoiceMuted = false;
let isVoiceDeafened = false;

const peerConnections = new Map();
const pendingIceCandidates = new Map();

voiceModal.style.display = 'none';

addVoiceBtn.onclick = () => {
  voiceModal.style.display = 'flex';
  voiceChannelInput.value = '';
  voiceChannelInput.focus();
};

cancelVoiceBtn.onclick = () => {
  voiceModal.style.display = 'none';
};

confirmVoiceBtn.onclick = () => {
  const name = voiceChannelInput.value.trim();
  if (!name) return;

  window.chatAPI.createVoiceChannel(name, (res) => {
    if (res.success) {
      voiceModal.style.display = 'none';
      voiceChannelInput.value = '';
    } else {
      alert(res.error || 'Error creating voice channel');
    }
  });
};

// vc channels span/div name changes
function renderVoiceChannels() {
  voiceChannelsContainer.innerHTML = '';

  voiceChannels.forEach((channel) => {
    const users = voiceUsersByChannel[channel.id] || [];
    const channelEl = document.createElement('div');
    channelEl.className = 'voice-channel';
    if (channel.id === currentVoiceChannelId) {
      channelEl.classList.add('active');
    }

    const topRow = document.createElement('div');
    topRow.className = 'voice-channel-top';

    const name = document.createElement('span');
    name.className = 'voice-channel-name';
    name.textContent = `VC ${channel.name}`;

    const count = document.createElement('span');
    count.className = 'voice-channel-count';
    count.textContent = users.length;

    topRow.appendChild(name);
    topRow.appendChild(count);
    channelEl.appendChild(topRow);

    if (channel.id === currentVoiceChannelId && users.length > 0) {
      const membersEl = document.createElement('div');
      membersEl.className = 'voice-members';

      users.forEach((user) => {
        const memberEl = document.createElement('div');
        memberEl.className = 'voice-member';

        if (user.socketId === currentVoiceSocketId) {
          memberEl.classList.add('self');
          memberEl.textContent = `${user.username} (you)`;
        } else {
          memberEl.textContent = user.username;
        }

        membersEl.appendChild(memberEl);
      });

      channelEl.appendChild(membersEl);
    }

    channelEl.onclick = () => joinVoiceChannel(channel.id);
    voiceChannelsContainer.appendChild(channelEl);
  });
}

function updateVoiceControls() {
  const connected = Boolean(currentVoiceChannelId);

  voiceStatusLabel.textContent = connected ? 'Voice connected' : 'Voice disconnected';
  voiceStatusChannel.textContent = connected ? currentVoiceChannelName : 'Not connected';
  muteVoiceBtn.disabled = !connected;
  deafenVoiceBtn.disabled = !connected;
  leaveVoiceBtn.disabled = !connected;
  muteVoiceBtn.textContent = isVoiceMuted ? 'Unmute' : 'Mute';
  deafenVoiceBtn.textContent = isVoiceDeafened ? 'Undeafen' : 'Deafen';
}

function emitJoinVoice(channelId) {
  return new Promise((resolve) => {
    window.chatAPI.joinVoice({
      channelId,
      userId: currentUserId,
      username: currentUsername
    }, resolve);
  });
}

function emitLeaveVoice() {
  return new Promise((resolve) => {
    window.chatAPI.leaveVoice(resolve);
  });
}

async function getLocalStream() {
  if (localStream) return localStream;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Microphone access is not available in this app window');
    throw new Error('getUserMedia is unavailable');
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
  } catch (err) {
    console.log(err);
    alert('Could not access your microphone');
    throw err;
  }

  return localStream;
}

function stopLocalStream() {
  if (!localStream) return;

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  isVoiceMuted = false;
}

function createPeerConnection(remoteSocketId) {
  const existingConnection = peerConnections.get(remoteSocketId);

  if (existingConnection && existingConnection.signalingState !== 'closed') {
    return existingConnection;
  }

  const peerConnection = new RTCPeerConnection({ iceServers: [] });

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate || !currentVoiceChannelId) return;

    window.chatAPI.sendVoiceIceCandidate({
      channelId: currentVoiceChannelId,
      to: remoteSocketId,
      candidate: serializeIceCandidate(event.candidate)
    });
  };

  peerConnection.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    attachRemoteAudio(remoteSocketId, stream);
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'failed') {
      closePeerConnection(remoteSocketId);
    }
  };

  peerConnections.set(remoteSocketId, peerConnection);
  return peerConnection;
}

function serializeDescription(description) {
  return description && description.toJSON ? description.toJSON() : description;
}

function serializeIceCandidate(candidate) {
  return candidate && candidate.toJSON ? candidate.toJSON() : candidate;
}
//deafen logic 
function attachRemoteAudio(remoteSocketId, stream) {
  let audioEl = remoteAudioContainer.querySelector(`[data-remote-socket-id="${remoteSocketId}"]`);

  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.dataset.remoteSocketId = remoteSocketId;
    remoteAudioContainer.appendChild(audioEl);
  }

  audioEl.srcObject = stream;
  audioEl.muted = isVoiceDeafened;
  audioEl.play().catch((err) => console.log(err));
}

function updateRemoteAudioMutedState() {
  remoteAudioContainer.querySelectorAll('audio').forEach((audioEl) => {
    audioEl.muted = isVoiceDeafened;
  });
}

function removeRemoteAudio(remoteSocketId) {
  const audioEl = remoteAudioContainer.querySelector(`[data-remote-socket-id="${remoteSocketId}"]`);
  if (audioEl) audioEl.remove();
}

function closePeerConnection(remoteSocketId) {
  const peerConnection = peerConnections.get(remoteSocketId);

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnections.delete(remoteSocketId);
  }

  pendingIceCandidates.delete(remoteSocketId);
  removeRemoteAudio(remoteSocketId);
}

function closeAllPeerConnections() {
  Array.from(peerConnections.keys()).forEach(closePeerConnection);
  remoteAudioContainer.innerHTML = '';
}

async function addIceCandidate(remoteSocketId, candidateData) {
  if (!candidateData) return;

  const peerConnection = peerConnections.get(remoteSocketId);
  const candidate = new RTCIceCandidate(candidateData);

  if (!peerConnection || !peerConnection.remoteDescription) {
    if (!pendingIceCandidates.has(remoteSocketId)) {
      pendingIceCandidates.set(remoteSocketId, []);
    }

    pendingIceCandidates.get(remoteSocketId).push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.log(err);
  }
}

async function flushPendingIceCandidates(remoteSocketId) {
  const peerConnection = peerConnections.get(remoteSocketId);
  const candidates = pendingIceCandidates.get(remoteSocketId);

  if (!peerConnection || !peerConnection.remoteDescription || !candidates) return;

  pendingIceCandidates.delete(remoteSocketId);

  for (const candidate of candidates) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.log(err);
    }
  }
}

async function createOfferForUser(remoteSocketId) {
  if (!currentVoiceChannelId || !remoteSocketId) return;

  const peerConnection = createPeerConnection(remoteSocketId);
  const offer = await peerConnection.createOffer();

  await peerConnection.setLocalDescription(offer);

  window.chatAPI.sendVoiceOffer({
    channelId: currentVoiceChannelId,
    to: remoteSocketId,
    offer: serializeDescription(peerConnection.localDescription)
  });
}

async function joinVoiceChannel(channelId) {
  if (!currentUserId) {
    alert('Log in before joining voice');
    return;
  }

  const channel = voiceChannels.find((voiceChannel) => voiceChannel.id === channelId);
  if (!channel || currentVoiceChannelId === channelId) return;

  if (currentVoiceChannelId) {
    await leaveVoiceChannel();
  }

  try {
    await getLocalStream();
  } catch (err) {
    return;
  }

  const response = await emitJoinVoice(channelId);

  if (!response || !response.success) {
    stopLocalStream();
    alert((response && response.error) || 'Could not join voice channel');
    return;
  }

  currentVoiceChannelId = channelId;
  currentVoiceChannelName = response.channel ? response.channel.name : channel.name;
  currentVoiceSocketId = response.socketId;
  isVoiceMuted = false;
  updateVoiceControls();
  renderVoiceChannels();

  for (const user of response.users || []) {
    try {
      await createOfferForUser(user.socketId);
    } catch (err) {
      console.log(err);
    }
  }
}

async function leaveVoiceChannel(notifyServer = true) {
  closeAllPeerConnections();
  stopLocalStream();

  currentVoiceChannelId = null;
  currentVoiceChannelName = '';
  currentVoiceSocketId = null;
  isVoiceDeafened = false;
  updateRemoteAudioMutedState();
  updateVoiceControls();
  renderVoiceChannels();

  if (notifyServer) {
    await emitLeaveVoice();
  }
}

async function handleVoiceOffer(data) {
  if (!data || data.channelId !== currentVoiceChannelId || !data.from) return;

  try {
    await getLocalStream();

    const peerConnection = createPeerConnection(data.from);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    await flushPendingIceCandidates(data.from);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    window.chatAPI.sendVoiceAnswer({
      channelId: data.channelId,
      to: data.from,
      answer: serializeDescription(peerConnection.localDescription)
    });
  } catch (err) {
    console.log(err);
  }
}

async function handleVoiceAnswer(data) {
  if (!data || data.channelId !== currentVoiceChannelId || !data.from) return;

  const peerConnection = peerConnections.get(data.from);
  if (!peerConnection || peerConnection.signalingState === 'stable') return;

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    await flushPendingIceCandidates(data.from);
  } catch (err) {
    console.log(err);
  }
}
//mute and deafen logic
function toggleVoiceMute() {
  if (!localStream) return;

  isVoiceMuted = !isVoiceMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isVoiceMuted;
  });

  updateVoiceControls();
}

function toggleVoiceDeafen() {
  if (!currentVoiceChannelId) return;

  isVoiceDeafened = !isVoiceDeafened;
  updateRemoteAudioMutedState();
  updateVoiceControls();
}

window.chatAPI.onVoiceChannels((data) => {
  voiceChannels = data.channels || [];
  voiceUsersByChannel = data.usersByChannel || {};
  renderVoiceChannels();
});

window.chatAPI.onVoiceUsers((data) => {
  if (!data || !data.channelId) return;

  voiceUsersByChannel[data.channelId] = data.users || [];
  renderVoiceChannels();
});

window.chatAPI.onVoiceUserJoined((data) => {
  if (!data || data.channelId !== currentVoiceChannelId) return;
  renderVoiceChannels();
});

window.chatAPI.onVoiceUserLeft((data) => {
  if (!data || data.channelId !== currentVoiceChannelId || !data.user) return;

  closePeerConnection(data.user.socketId);
  renderVoiceChannels();
});

window.chatAPI.onVoiceOffer((data) => {
  handleVoiceOffer(data);
});

window.chatAPI.onVoiceAnswer((data) => {
  handleVoiceAnswer(data);
});

window.chatAPI.onVoiceIceCandidate((data) => {
  if (!data || data.channelId !== currentVoiceChannelId || !data.from) return;
  addIceCandidate(data.from, data.candidate);
});

window.chatAPI.onVoiceError((data) => {
  if (data && data.message) {
    console.log(data.message);
  }
});

muteVoiceBtn.onclick = toggleVoiceMute;
deafenVoiceBtn.onclick = toggleVoiceDeafen;
leaveVoiceBtn.onclick = () => leaveVoiceChannel();

window.addEventListener('beforeunload', () => {
  if (currentVoiceChannelId) {
    window.chatAPI.leaveVoice(() => {});
  }

  closeAllPeerConnections();
  stopLocalStream();
});

updateVoiceControls();

// Signup modal + account creation
const signupModal = document.getElementById('signup-modal');
const signupBtn = document.getElementById('sign-up-btn');
const signupCancelBtn = document.getElementById('signup-cancel');

const signupForm = document.getElementById('signupForm');
const signupMessage = document.getElementById('signup-message');

// hidden on startup
signupModal.style.display = 'none';

signupBtn.onclick = () => {
  signupModal.style.display = 'flex';
  signupMessage.innerText = '';
  signupForm.reset();
};

signupCancelBtn.onclick = () => {
  signupModal.style.display = 'none';
};

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('http://localhost:3000/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();
    signupMessage.innerText = data.message;

    if (response.ok) {
      signupModal.style.display = 'none';
      signupForm.reset();
    }
  } catch (err) {
    console.log(err);
    signupMessage.innerText = 'Server error';
  }
});

// Login modal
const loginModal = document.getElementById('login-modal');
const loginBtn = document.getElementById('login-btn');
const loginCancelBtn = document.getElementById('login-cancel');

const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('login-message');

loginModal.style.display = 'none';

loginBtn.onclick = () => {
  loginModal.style.display = 'flex';
  loginMessage.innerText = '';
  loginForm.reset();
};

loginCancelBtn.onclick = () => {
  loginModal.style.display = 'none';
};

let currentUsername = 'anonymous';

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const response = await fetch('http://localhost:3000/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    loginMessage.innerText = data.message;

    if (response.ok) {
      currentUserId = data.userId;
      currentUsername = data.username || currentUsername;
      loginModal.style.display = 'none';
      loginForm.reset();
      renderVoiceChannels();
    }
  } catch (err) {
    console.log(err);
    loginMessage.innerText = 'Server error';
  }
});
