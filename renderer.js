const information = document.getElementById('info');
information.innerText = `This app is using Chrome (v${window.versions.chrome()}), Node.js (v${window.versions.node()}), and Electron (v${window.versions.electron()})`;

let message;

const form = document.getElementById('form');
const messageInput = document.getElementById('message');
const messageArea = document.getElementById('messageArea');
const databaseUsersContainer = document.getElementById('database-users');

let currentChannelId = 1;
let currentUserId = null;
let currentUsername = 'anonymous';

function renderDatabaseUsers(users) {
  databaseUsersContainer.innerHTML = '';

  users.forEach((user) => {
    const userEl = document.createElement('div');
    userEl.className = 'user-placeholder database-user';
    userEl.dataset.userId = user.id;
    userEl.textContent = user.username;
    databaseUsersContainer.appendChild(userEl);
  });
}

async function loadDatabaseUsers() {
  try {
    const response = await fetch('http://localhost:3000/users');
    const data = await response.json();

    if (response.ok) {
      renderDatabaseUsers(data.users || []);
    }
  } catch (err) {
    console.log(err);
  }
}

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
const voiceSettingsBtn = document.getElementById('voice-settings-btn');
const voiceSettingsModal = document.getElementById('voice-settings-modal');
const micDeviceSelect = document.getElementById('mic-device-select');
const audioOutputSelect = document.getElementById('audio-output-select');
const voiceSettingsRefreshBtn = document.getElementById('voice-settings-refresh');
const voiceSettingsCloseBtn = document.getElementById('voice-settings-close');
const audioOutputWarning = document.getElementById('audio-output-warning');
const appearanceControls = document.getElementById('appearance-controls');
const appearanceResetBtn = document.getElementById('appearance-reset');
const remoteAudioContainer = document.getElementById('remote-audio-container');
const remoteVolumeMenu = document.getElementById('remote-volume-menu');
const remoteVolumeMenuName = document.getElementById('remote-volume-menu-name');
const remoteVolumeSlider = document.getElementById('remote-volume-slider');
const remoteVolumeValue = document.getElementById('remote-volume-value');

const DEFAULT_REMOTE_VOLUME = 100;
const MAX_REMOTE_VOLUME = 200;
const SPEAKING_LEVEL_THRESHOLD = 0.035;
const SPEAKING_RELEASE_DELAY = 250;
const supportsAudioOutputSelection = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const appearanceSettings = [
  {key: 'directoryBg', label: 'Directory', cssVar: '--directory-bg', defaultColor: '#3D3D3D'},
  {key: 'channelListBg', label: 'Channels', cssVar: '--channel-list-bg', defaultColor: '#9C7E7E'},
  {key: 'chatBg', label: 'Chat', cssVar: '--chat-bg', defaultColor: '#928989'},
  {key: 'usersBg', label: 'Users', cssVar: '--users-bg', defaultColor: '#C9C7C7'},
  {key: 'surfaceBg', label: 'Voice/Settings Panel', cssVar: '--surface-bg', defaultColor: '#36393F'},
  {key: 'inputBg', label: 'Inputs', cssVar: '--input-bg', defaultColor: '#222222'},
  {key: 'buttonBg', label: 'Buttons', cssVar: '--button-bg', defaultColor: '#575757'},
  {key: 'buttonHoverBg', label: 'Button hover', cssVar: '--button-hover-bg', defaultColor: '#7C7C7C'},
  {key: 'activeBg', label: 'Active Channel', cssVar: '--active-bg', defaultColor: '#A3A3A3'},
  {key: 'menuBg', label: 'Menus', cssVar: '--menu-bg', defaultColor: '#18191C'},
  {key: 'overlayBg', label: 'Overlay', cssVar: '--overlay-bg', defaultColor: '#000000'}
];

let voiceChannels = [];
let voiceUsersByChannel = {};
let currentVoiceChannelId = null;
let currentVoiceChannelName = '';
let currentVoiceSocketId = null;
let localStream = null;
let isVoiceMuted = false;
let isVoiceDeafened = false;
let selectedMicDeviceId = localStorage.getItem('selectedMicDeviceId') || '';
let selectedAudioOutputDeviceId = localStorage.getItem('selectedAudioOutputDeviceId') || '';

const peerConnections = new Map();
const pendingIceCandidates = new Map();
const remoteAudioPipelines = new Map();
const remoteUserVolumes = new Map();
const speakingSocketIds = new Set();
let activeRemoteVolumeSocketId = null;
let localVoiceActivityDetector = null;

voiceModal.style.display = 'none';
voiceSettingsModal.style.display = 'none';

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

voiceSettingsBtn.onclick = async () => {
  voiceSettingsModal.style.display = 'flex';
  await refreshAudioDevices();
};

voiceSettingsCloseBtn.onclick = () => {
  voiceSettingsModal.style.display = 'none';
};

voiceSettingsRefreshBtn.onclick = () => {
  refreshAudioDevices();
};

voiceSettingsModal.addEventListener('click', (event) => {
  if (event.target === voiceSettingsModal) {
    voiceSettingsModal.style.display = 'none';
  }
});

micDeviceSelect.onchange = async () => {
  const previousMicDeviceId = selectedMicDeviceId;
  selectedMicDeviceId = micDeviceSelect.value;

  if (selectedMicDeviceId) {
    localStorage.setItem('selectedMicDeviceId', selectedMicDeviceId);
  } else {
    localStorage.removeItem('selectedMicDeviceId');
  }

  if (currentVoiceChannelId) {
    const switched = await switchMicrophoneDevice();

    if (!switched) {
      selectedMicDeviceId = previousMicDeviceId;
      micDeviceSelect.value = previousMicDeviceId;

      if (selectedMicDeviceId) {
        localStorage.setItem('selectedMicDeviceId', selectedMicDeviceId);
      } else {
        localStorage.removeItem('selectedMicDeviceId');
      }
    }
  }
};

audioOutputSelect.onchange = () => {
  selectedAudioOutputDeviceId = audioOutputSelect.value;

  if (selectedAudioOutputDeviceId) {
    localStorage.setItem('selectedAudioOutputDeviceId', selectedAudioOutputDeviceId);
  } else {
    localStorage.removeItem('selectedAudioOutputDeviceId');
  }

  applyAudioOutputToAllRemoteAudio();
};

remoteVolumeSlider.oninput = () => {
  if (!activeRemoteVolumeSocketId) return;

  const volume = setRemoteUserVolume(activeRemoteVolumeSocketId, remoteVolumeSlider.value);
  remoteVolumeValue.textContent = `${volume}%`;
};

remoteVolumeMenu.addEventListener('click', (event) => {
  event.stopPropagation();
});

document.addEventListener('click', () => {
  closeRemoteVolumeMenu();
});

document.addEventListener('contextmenu', (event) => {
  if (!remoteVolumeMenu.hidden && !remoteVolumeMenu.contains(event.target)) {
    closeRemoteVolumeMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeRemoteVolumeMenu();
  }
});

function getAppearanceStorageKey(setting) {
  return `appearance:${setting.key}`;
}

function normalizeHexColor(value) {
  const trimmedValue = String(value || '').trim();
  const match = trimmedValue.match(/^#?([0-9a-f]{6})$/i);

  return match ? `#${match[1].toUpperCase()}` : null;
}

function getSavedAppearanceColor(setting) {
  return normalizeHexColor(localStorage.getItem(getAppearanceStorageKey(setting))) || setting.defaultColor;
}

function setAppearanceColor(setting, color, shouldSave = true) {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return null;

  document.documentElement.style.setProperty(setting.cssVar, normalizedColor);

  if (shouldSave) {
    localStorage.setItem(getAppearanceStorageKey(setting), normalizedColor);
  }

  return normalizedColor;
}

function createAppearanceControl(setting) {
  const savedColor = setAppearanceColor(setting, getSavedAppearanceColor(setting), false);
  const controlEl = document.createElement('div');
  controlEl.className = 'appearance-control';

  const labelEl = document.createElement('label');
  labelEl.textContent = setting.label;
  labelEl.htmlFor = `appearance-${setting.key}`;

  const colorInput = document.createElement('input');
  colorInput.className = 'appearance-color';
  colorInput.type = 'color';
  colorInput.id = `appearance-${setting.key}`;
  colorInput.value = savedColor;

  const hexInput = document.createElement('input');
  hexInput.className = 'appearance-hex';
  hexInput.type = 'text';
  hexInput.value = savedColor;
  hexInput.maxLength = 7;
  hexInput.setAttribute('aria-label', `${setting.label} hex color`);

  colorInput.oninput = () => {
    const color = setAppearanceColor(setting, colorInput.value);
    if (!color) return;

    hexInput.value = color;
    hexInput.classList.remove('invalid');
  };

  hexInput.oninput = () => {
    hexInput.value = hexInput.value.toUpperCase();
    const color = normalizeHexColor(hexInput.value);

    if (!color) {
      hexInput.classList.add('invalid');
      return;
    }

    hexInput.classList.remove('invalid');
    colorInput.value = color;
    setAppearanceColor(setting, color);
  };

  hexInput.onblur = () => {
    const color = normalizeHexColor(hexInput.value) || getSavedAppearanceColor(setting);
    hexInput.value = color;
    colorInput.value = color;
    hexInput.classList.remove('invalid');
  };

  controlEl.appendChild(labelEl);
  controlEl.appendChild(colorInput);
  controlEl.appendChild(hexInput);

  return controlEl;
}

function renderAppearanceControls() {
  appearanceControls.innerHTML = '';

  appearanceSettings.forEach((setting) => {
    appearanceControls.appendChild(createAppearanceControl(setting));
  });
}

function resetAppearanceSettings() {
  appearanceSettings.forEach((setting) => {
    localStorage.removeItem(getAppearanceStorageKey(setting));
    setAppearanceColor(setting, setting.defaultColor, false);
  });

  renderAppearanceControls();
}

appearanceResetBtn.onclick = resetAppearanceSettings;
renderAppearanceControls();

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

        const memberName = document.createElement('span');
        memberName.className = 'voice-member-name';
        memberName.dataset.voiceSocketId = user.socketId;

        if (speakingSocketIds.has(user.socketId)) {
          memberName.classList.add('speaking');
        }

        if (user.socketId === currentVoiceSocketId) {
          memberEl.classList.add('self');
          memberName.textContent = `${user.username} (you)`;
        } else {
          memberName.textContent = user.username;
          memberName.classList.add('can-open-menu');
          memberName.oncontextmenu = (event) => openRemoteVolumeMenu(event, user);
        }

        memberEl.insertBefore(memberName, memberEl.firstChild);
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

function clampRemoteVolume(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_REMOTE_VOLUME;
  }

  return Math.max(0, Math.min(MAX_REMOTE_VOLUME, Math.round(numericValue)));
}

function getRemoteUserVolume(remoteSocketId) {
  return remoteUserVolumes.has(remoteSocketId)
    ? remoteUserVolumes.get(remoteSocketId)
    : DEFAULT_REMOTE_VOLUME;
}

function setRemoteUserVolume(remoteSocketId, value) {
  const volume = clampRemoteVolume(value);
  remoteUserVolumes.set(remoteSocketId, volume);
  applyRemoteUserVolume(remoteSocketId);
  return volume;
}

function closeRemoteVolumeMenu() {
  activeRemoteVolumeSocketId = null;
  remoteVolumeMenu.hidden = true;
}

function positionRemoteVolumeMenu(x, y) {
  remoteVolumeMenu.style.left = '0px';
  remoteVolumeMenu.style.top = '0px';
  remoteVolumeMenu.hidden = false;

  const menuRect = remoteVolumeMenu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(x, window.innerWidth - menuRect.width - margin);
  const top = Math.min(y, window.innerHeight - menuRect.height - margin);

  remoteVolumeMenu.style.left = `${Math.max(margin, left)}px`;
  remoteVolumeMenu.style.top = `${Math.max(margin, top)}px`;
}

function openRemoteVolumeMenu(event, user) {
  event.preventDefault();
  event.stopPropagation();

  activeRemoteVolumeSocketId = user.socketId;
  const volume = getRemoteUserVolume(user.socketId);

  remoteVolumeMenuName.textContent = user.username;
  remoteVolumeSlider.value = String(volume);
  remoteVolumeValue.textContent = `${volume}%`;
  positionRemoteVolumeMenu(event.clientX, event.clientY);
  remoteVolumeSlider.focus();
}

function setVoiceSpeaking(socketId, isSpeaking) {
  if (!socketId) return;

  if (isSpeaking) {
    speakingSocketIds.add(socketId);
  } else {
    speakingSocketIds.delete(socketId);
  }

  document.querySelectorAll('.voice-member-name').forEach((nameEl) => {
    if (nameEl.dataset.voiceSocketId === socketId) {
      nameEl.classList.toggle('speaking', isSpeaking);
    }
  });
}

function createVoiceActivityDetector(socketId, stream, options = {}) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!socketId || !stream || !AudioContextConstructor) return null;

  const audioContext = options.audioContext || new AudioContextConstructor();
  const sourceNode = options.sourceNode || audioContext.createMediaStreamSource(stream);
  const analyserNode = audioContext.createAnalyser();
  const ownsAudioContext = !options.audioContext;
  const ownsSourceNode = !options.sourceNode;
  let animationFrameId = null;
  let lastActiveAt = 0;
  let isStopped = false;

  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.25;
  const sampleData = new Uint8Array(analyserNode.fftSize);
  sourceNode.connect(analyserNode);

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch((err) => console.log(err));
  }

  const readAudioLevel = () => {
    analyserNode.getByteTimeDomainData(sampleData);

    let total = 0;
    for (let i = 0; i < sampleData.length; i++) {
      const level = (sampleData[i] - 128) / 128;
      total += level * level;
    }

    return Math.sqrt(total / sampleData.length);
  };

  const update = () => {
    if (isStopped) return;

    const now = performance.now();
    const shouldForceSilent = options.isSilent && options.isSilent();
    const audioLevel = shouldForceSilent ? 0 : readAudioLevel();

    if (audioLevel >= SPEAKING_LEVEL_THRESHOLD) {
      lastActiveAt = now;
      setVoiceSpeaking(socketId, true);
    } else if (now - lastActiveAt > SPEAKING_RELEASE_DELAY) {
      setVoiceSpeaking(socketId, false);
    }

    animationFrameId = requestAnimationFrame(update);
  };

  update();

  return {
    stop() {
      isStopped = true;

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      try {
        sourceNode.disconnect(analyserNode);
      } catch (err) {
        console.log(err);
      }

      analyserNode.disconnect();

      if (ownsSourceNode) {
        try {
          sourceNode.disconnect();
        } catch (err) {
          console.log(err);
        }
      }

      if (ownsAudioContext) {
        audioContext.close().catch((err) => console.log(err));
      }

      setVoiceSpeaking(socketId, false);
    }
  };
}

function startLocalVoiceActivity(stream) {
  stopLocalVoiceActivity();

  if (!currentVoiceSocketId || !stream) return;

  localVoiceActivityDetector = createVoiceActivityDetector(currentVoiceSocketId, stream, {
    isSilent: () => isVoiceMuted || !currentVoiceChannelId
  });
}

function stopLocalVoiceActivity() {
  if (!localVoiceActivityDetector) return;

  localVoiceActivityDetector.stop();
  localVoiceActivityDetector = null;
}

function applyRemoteUserVolume(remoteSocketId) {
  const pipeline = remoteAudioPipelines.get(remoteSocketId);
  if (!pipeline) return;

  const volumeMultiplier = getRemoteUserVolume(remoteSocketId) / 100;

  if (pipeline.gainNode) {
    pipeline.gainNode.gain.value = volumeMultiplier;
    pipeline.audioEl.volume = 1;
  } else {
    pipeline.audioEl.volume = Math.min(volumeMultiplier, 1);
  }
}

function getAudioInputConstraints() {
  if (!selectedMicDeviceId) return true;
  return {
    deviceId: {
      exact: selectedMicDeviceId
    }
  };
}

function getDeviceLabel(device, fallbackName, index) {
  return device.label || `${fallbackName} ${index + 1}`;
}

function populateDeviceSelect(selectEl, devices, defaultLabel, fallbackName, selectedDeviceId) {
  selectEl.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  selectEl.appendChild(defaultOption);

  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = getDeviceLabel(device, fallbackName, index);
    selectEl.appendChild(option);
  });

  const hasSelectedDevice = devices.some((device) => device.deviceId === selectedDeviceId);

  if (selectedDeviceId && !hasSelectedDevice) {
    const missingOption = document.createElement('option');
    missingOption.value = selectedDeviceId;
    missingOption.textContent = 'Unavailable device';
    selectEl.appendChild(missingOption);
  }

  selectEl.value = selectedDeviceId && (hasSelectedDevice || selectedDeviceId) ? selectedDeviceId : '';
}

async function refreshAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    micDeviceSelect.disabled = true;
    audioOutputSelect.disabled = true;
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputDevices = devices.filter((device) => device.kind === 'audioinput');
    const outputDevices = devices.filter((device) => device.kind === 'audiooutput');

    populateDeviceSelect(
      micDeviceSelect,
      inputDevices,
      'Default microphone',
      'Microphone',
      selectedMicDeviceId
    );

    if (supportsAudioOutputSelection) {
      populateDeviceSelect(
        audioOutputSelect,
        outputDevices,
        'Default speaker',
        'Speaker',
        selectedAudioOutputDeviceId
      );
      audioOutputSelect.disabled = false;
      audioOutputWarning.hidden = true;
    } else {
      populateDeviceSelect(audioOutputSelect, [], 'Default speaker', 'Speaker', '');
      audioOutputSelect.disabled = true;
      audioOutputWarning.hidden = false;
    }

    micDeviceSelect.disabled = false;
  } catch (err) {
    console.log(err);
  }
}

async function applyAudioOutputDevice(audioEl) {
  if (!audioEl || typeof audioEl.setSinkId !== 'function') return;

  try {
    await audioEl.setSinkId(selectedAudioOutputDeviceId || '');
  } catch (err) {
    console.log(err);
  }
}

function applyAudioOutputToAllRemoteAudio() {
  remoteAudioContainer.querySelectorAll('audio').forEach((audioEl) => {
    applyAudioOutputDevice(audioEl);
  });
}

async function switchMicrophoneDevice() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Microphone access is not available in this app window');
    return false;
  }

  const previousStream = localStream;
  let nextStream = null;

  try {
    nextStream = await navigator.mediaDevices.getUserMedia({
      audio: getAudioInputConstraints(),
      video: false
    });

    nextStream.getAudioTracks().forEach((track) => {
      track.enabled = !isVoiceMuted;
    });

    localStream = nextStream;
    const audioTrack = nextStream.getAudioTracks()[0];

    await Promise.all(Array.from(peerConnections.values()).map(async (peerConnection) => {
      const audioSender = peerConnection.getSenders().find((sender) => {
        return sender.track && sender.track.kind === 'audio';
      });

      if (audioSender && audioTrack) {
        await audioSender.replaceTrack(audioTrack);
      } else if (audioTrack) {
        peerConnection.addTrack(audioTrack, nextStream);
      }
    }));

    if (previousStream && previousStream !== nextStream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }

    startLocalVoiceActivity(nextStream);
    refreshAudioDevices();
    return true;
  } catch (err) {
    console.log(err);

    if (nextStream) {
      nextStream.getTracks().forEach((track) => track.stop());
    }

    localStream = previousStream;
    alert('Could not switch microphone');
    return false;
  }
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
      audio: getAudioInputConstraints(),
      video: false
    });
  } catch (err) {
    if (selectedMicDeviceId) {
      console.log(err);
      selectedMicDeviceId = '';
      localStorage.removeItem('selectedMicDeviceId');

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      } catch (fallbackErr) {
        console.log(fallbackErr);
        alert('Could not access your microphone');
        throw fallbackErr;
      }
    } else {
      console.log(err);
      alert('Could not access your microphone');
      throw err;
    }
  }

  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isVoiceMuted;
  });
  startLocalVoiceActivity(localStream);
  refreshAudioDevices();

  return localStream;
}

function stopLocalStream() {
  stopLocalVoiceActivity();

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
function createRemoteAudioPipeline(remoteSocketId, stream, audioEl) {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextConstructor) {
    audioEl.srcObject = stream;
    const fallbackPipeline = {
      audioEl,
      stream,
      audioContext: null,
      sourceNode: null,
      gainNode: null,
      destinationNode: null,
      activityDetector: null
    };
    remoteAudioPipelines.set(remoteSocketId, fallbackPipeline);
    return fallbackPipeline;
  }

  const audioContext = new AudioContextConstructor();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  const destinationNode = audioContext.createMediaStreamDestination();

  sourceNode.connect(gainNode);
  gainNode.connect(destinationNode);
  audioEl.srcObject = destinationNode.stream;
  const activityDetector = createVoiceActivityDetector(remoteSocketId, stream, {
    audioContext,
    sourceNode
  });

  const pipeline = {
    audioEl,
    stream,
    audioContext,
    sourceNode,
    gainNode,
    destinationNode,
    activityDetector
  };

  remoteAudioPipelines.set(remoteSocketId, pipeline);
  return pipeline;
}

function destroyRemoteAudioPipeline(remoteSocketId, removeElement) {
  const pipeline = remoteAudioPipelines.get(remoteSocketId);
  if (!pipeline) return;

  if (pipeline.activityDetector) {
    pipeline.activityDetector.stop();
  }

  if (pipeline.sourceNode) {
    pipeline.sourceNode.disconnect();
  }

  if (pipeline.gainNode) {
    pipeline.gainNode.disconnect();
  }

  if (pipeline.audioContext) {
    pipeline.audioContext.close().catch((err) => console.log(err));
  }

  pipeline.audioEl.srcObject = null;

  if (removeElement) {
    pipeline.audioEl.remove();
  }

  remoteAudioPipelines.delete(remoteSocketId);
  setVoiceSpeaking(remoteSocketId, false);
}

function attachRemoteAudio(remoteSocketId, stream) {
  let audioEl = remoteAudioContainer.querySelector(`[data-remote-socket-id="${remoteSocketId}"]`);

  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.dataset.remoteSocketId = remoteSocketId;
    remoteAudioContainer.appendChild(audioEl);
  }

  const existingPipeline = remoteAudioPipelines.get(remoteSocketId);

  if (!existingPipeline || existingPipeline.stream !== stream) {
    destroyRemoteAudioPipeline(remoteSocketId, false);
    createRemoteAudioPipeline(remoteSocketId, stream, audioEl);
  }

  applyRemoteUserVolume(remoteSocketId);
  applyAudioOutputDevice(audioEl);
  audioEl.muted = isVoiceDeafened;

  const pipeline = remoteAudioPipelines.get(remoteSocketId);
  if (pipeline && pipeline.audioContext && pipeline.audioContext.state === 'suspended') {
    pipeline.audioContext.resume().catch((err) => console.log(err));
  }

  audioEl.play().catch((err) => console.log(err));
}

function updateRemoteAudioMutedState() {
  remoteAudioContainer.querySelectorAll('audio').forEach((audioEl) => {
    audioEl.muted = isVoiceDeafened;
  });
}

function removeRemoteAudio(remoteSocketId) {
  const audioEl = remoteAudioContainer.querySelector(`[data-remote-socket-id="${remoteSocketId}"]`);
  const hadPipeline = remoteAudioPipelines.has(remoteSocketId);

  if (activeRemoteVolumeSocketId === remoteSocketId) {
    closeRemoteVolumeMenu();
  }

  setVoiceSpeaking(remoteSocketId, false);
  destroyRemoteAudioPipeline(remoteSocketId, Boolean(audioEl));
  remoteUserVolumes.delete(remoteSocketId);

  if (audioEl && !hadPipeline) {
    audioEl.remove();
  }
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
  Array.from(remoteAudioPipelines.keys()).forEach(removeRemoteAudio);
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
  startLocalVoiceActivity(localStream);
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

  if (isVoiceMuted) {
    setVoiceSpeaking(currentVoiceSocketId, false);
  }

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
refreshAudioDevices();
loadDatabaseUsers();

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices);
}

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
      loadDatabaseUsers();
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
