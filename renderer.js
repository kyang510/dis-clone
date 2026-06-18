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
let textChannels = [];
const DEFAULT_CHANNEL_ID = 1;
const MAX_VISIBLE_MESSAGES = 100;
let messageLoadRequestId = 0;
let isLoadingMessages = false;
let queuedLiveMessages = [];
let renderedMessageIds = new Set();

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
    const data = await window.chatAPI.getUsers();

    if (data.success) {
      renderDatabaseUsers(data.users || []);
    }
  } catch (err) {
    console.log(err);
  }
}

function updateAuthControls() {
  const loginButton = document.getElementById('login-btn');
  const signupButton = document.getElementById('sign-up-btn');

  if (loginButton) {
    loginButton.textContent = currentUserId ? 'out' : '=';
    loginButton.title = currentUserId ? 'Log out' : 'Log in';
  }

  if (signupButton) {
    signupButton.hidden = Boolean(currentUserId);
  }
}

function applyAuthenticatedUser(user) {
  currentUserId = user && user.id;
  currentUsername = (user && user.username) || 'anonymous';
  updateAuthControls();
  renderVoiceChannels();
  loadDatabaseUsers();
  loadChannelMessages(currentChannelId);
}

function clearAuthenticatedUser() {
  currentUserId = null;
  currentUsername = 'anonymous';
  messageArea.innerHTML = '';
  databaseUsersContainer.innerHTML = '';
  resetRenderedMessageIds();
  updateAuthControls();
  renderVoiceChannels();
}

// Create Channel modal
const modal = document.getElementById('channel-modal');
const channelModalTitle = document.getElementById('channel-modal-title');
const channelInput = document.getElementById('channel-name-input');
const addBtn = document.getElementById('add-channel-btn');
const confirmBtn = document.getElementById('create-channel-confirm');
const cancelBtn = document.getElementById('create-channel-cancel');
let channelModalMode = 'create';
let editingChannelId = null;

// hidden on startup
modal.style.display = 'none';

function openTextChannelModal(mode = 'create', channel = null) {
  channelModalMode = mode;
  editingChannelId = channel ? parseChannelId(channel.id, 0) : null;
  channelModalTitle.textContent = mode === 'edit' ? 'Edit Channel' : 'Create Channel';
  confirmBtn.textContent = mode === 'edit' ? 'Save' : 'Create';
  modal.style.display = 'flex';
  channelInput.value = channel ? channel.name : '';
  channelInput.placeholder = '# new-channel';
  channelInput.focus();
  channelInput.select();
}

function closeTextChannelModal() {
  modal.style.display = 'none';
  channelInput.value = '';
  channelModalMode = 'create';
  editingChannelId = null;
}

addBtn.onclick = () => {
  openTextChannelModal('create');
};

cancelBtn.onclick = () => {
  closeTextChannelModal();
};

confirmBtn.onclick = () => {
  const name = channelInput.value.trim();
  if (!name) return;

  const finish = (res) => {
    if (res.success) {
      closeTextChannelModal();
    } else {
      alert(res.error || 'Error saving channel');
    }
  };

  if (channelModalMode === 'edit') {
    window.chatAPI.editChannel({channelId: editingChannelId, name}, finish);
    return;
  }

  window.chatAPI.sendChannel(name, finish);
};

function parseChannelId(channelId, fallback = DEFAULT_CHANNEL_ID) {
  const parsed = Number.parseInt(channelId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getMessageChannelId(data) {
  return parseChannelId(data && data.channelId, DEFAULT_CHANNEL_ID);
}

const channelContextMenu = document.getElementById('channel-context-menu');
const messageContextMenu = document.getElementById('message-context-menu');
let activeChannelContext = null;
let activeMessageContext = null;

function closeChannelContextMenu() {
  activeChannelContext = null;
  channelContextMenu.hidden = true;
}

function closeMessageContextMenu() {
  activeMessageContext = null;
  messageContextMenu.hidden = true;
}

function positionChannelContextMenu(x, y) {
  channelContextMenu.style.left = '0px';
  channelContextMenu.style.top = '0px';
  channelContextMenu.hidden = false;

  const menuRect = channelContextMenu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(x, window.innerWidth - menuRect.width - margin);
  const top = Math.min(y, window.innerHeight - menuRect.height - margin);

  channelContextMenu.style.left = `${Math.max(margin, left)}px`;
  channelContextMenu.style.top = `${Math.max(margin, top)}px`;
}

function openChannelContextMenu(event, type, channel) {
  event.preventDefault();
  event.stopPropagation();

  closeRemoteVolumeMenu();
  closeMessageContextMenu();
  activeChannelContext = {
    type,
    channel: {
      id: parseChannelId(channel && channel.id, 0),
      name: (channel && channel.name) || ''
    }
  };

  positionChannelContextMenu(event.clientX, event.clientY);
}

function positionMessageContextMenu(x, y) {
  messageContextMenu.style.left = '0px';
  messageContextMenu.style.top = '0px';
  messageContextMenu.hidden = false;

  const menuRect = messageContextMenu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(x, window.innerWidth - menuRect.width - margin);
  const top = Math.min(y, window.innerHeight - menuRect.height - margin);

  messageContextMenu.style.left = `${Math.max(margin, left)}px`;
  messageContextMenu.style.top = `${Math.max(margin, top)}px`;
}

function openMessageContextMenu(event, message) {
  event.preventDefault();
  event.stopPropagation();

  closeChannelContextMenu();
  closeRemoteVolumeMenu();

  const userId = message && message.userId != null ? String(message.userId) : '';
  const canModify = true;

  activeMessageContext = {
    id: message && message.id,
    channelId: message && message.channelId,
    userId: message && message.userId,
    message: (message && message.message) || '',
    canModify
  };

  messageContextMenu.querySelector('[data-message-action="edit"]').hidden = !canModify;
  messageContextMenu.querySelector('[data-message-action="delete"]').hidden = !canModify;
  positionMessageContextMenu(event.clientX, event.clientY);
}

function runChannelAction(action) {
  const context = activeChannelContext;
  closeChannelContextMenu();

  if (action === 'create-text') {
    openTextChannelModal('create');
    return;
  }

  if (action === 'create-voice') {
    openVoiceChannelModal('create');
    return;
  }

  if (!context || !context.channel || !context.channel.id) return;

  if (action === 'edit') {
    if (context.type === 'voice') {
      openVoiceChannelModal('edit', context.channel);
    } else {
      openTextChannelModal('edit', context.channel);
    }
    return;
  }

  if (action === 'duplicate') {
    const duplicate = context.type === 'voice'
      ? window.chatAPI.duplicateVoiceChannel
      : window.chatAPI.duplicateChannel;

    duplicate({channelId: context.channel.id}, (res) => {
      if (!res || !res.success) {
        alert((res && res.error) || 'Could not duplicate channel');
      }
    });
    return;
  }

  if (action === 'delete') {
    const label = context.type === 'voice' ? `VC ${context.channel.name}` : `# ${context.channel.name}`;

    if (!confirm(`Delete ${label}?`)) {
      return;
    }

    const remove = context.type === 'voice'
      ? window.chatAPI.deleteVoiceChannel
      : window.chatAPI.deleteChannel;

    remove({channelId: context.channel.id}, (res) => {
      if (!res || !res.success) {
        alert((res && res.error) || 'Could not delete channel');
      }
    });
  }
}

function runMessageAction(action) {
  const context = activeMessageContext;
  closeMessageContextMenu();

  if (!context || !context.id) return;

  if (action === 'copy') {
    window.chatAPI.copyText(context.message);
    return;
  }

  if (!context.canModify) return;

  if (action === 'edit') {
    startInlineEdit(context.id, context.message);
      return;
  }

function startInlineEdit(messageId, currentMessage) {
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;

  const textContainer = messageEl.querySelector('.text');
  if (!textContainer) return;

  textContainer.innerHTML = '';

  const input = document.createElement('input');
  input.className = 'message-edit-input';
  input.value = currentMessage;

  const hint = document.createElement('div');
  hint.className = 'edit-hint';
  hint.textContent = 'escape to cancel • enter to save';

  textContainer.appendChild(input);
  textContainer.appendChild(hint);

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      loadChannelMessages(currentChannelId);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      const newMessage = input.value.trim();

      if (!newMessage || newMessage === currentMessage) {
        loadChannelMessages(currentChannelId);
        return;
      }

      console.log('saving edit:', {
        messageId,
        message: newMessage
      });

      window.chatAPI.editMessage({
        messageId,
        message: newMessage
      }, (res) => {
        console.log('edit response:', res);

        if (!res || !res.success) {
          alert((res && res.error) || 'Could not edit message');
          return;
        }

        loadChannelMessages(currentChannelId);
      });
    }
  });
}

  if (action === 'delete') {
    if (!confirm('Delete this message?')) return;

    window.chatAPI.deleteMessage({messageId: context.id}, (res) => {
      if (!res || !res.success) {
        alert((res && res.error) || 'Could not delete message');
      }
    });
  }
}

channelContextMenu.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-channel-action]');
  if (!actionButton) return;

  event.stopPropagation();
  runChannelAction(actionButton.dataset.channelAction);
});

messageContextMenu.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-message-action]');
  if (!actionButton) return;

  event.stopPropagation();
  runMessageAction(actionButton.dataset.messageAction);
});

document.addEventListener('click', () => {
  closeChannelContextMenu();
  closeMessageContextMenu();
});
document.addEventListener('contextmenu', (event) => {
  if (!channelContextMenu.hidden && !channelContextMenu.contains(event.target)) {
    closeChannelContextMenu();
  }

  if (!messageContextMenu.hidden && !messageContextMenu.contains(event.target)) {
    closeMessageContextMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeChannelContextMenu();
    closeMessageContextMenu();
  }
});

function formatMessageTime(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday - startOfMessageDay) / 86400000);
  const time = new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);

  if (daysAgo === 0) {
    return time;
  }

  if (daysAgo === 1) {
    return `Yesterday ${time}`;
  }

  const dateParts = {
    month: 'short',
    day: 'numeric'
  };

  if (date.getFullYear() !== now.getFullYear()) {
    dateParts.year = 'numeric';
  }

  return `${new Intl.DateTimeFormat([], dateParts).format(date)}, ${time}`;
}

function resetRenderedMessageIds() {
  renderedMessageIds = new Set();
}

function trimVisibleMessages() {
  while (messageArea.children.length > MAX_VISIBLE_MESSAGES) {
    const firstMessage = messageArea.firstElementChild;
    const messageId = firstMessage && firstMessage.dataset.messageId;

    if (messageId) {
      renderedMessageIds.delete(messageId);
    }

    firstMessage.remove();
  }
}

function hasEditedMarker(data) {
  return Boolean(data && (data.editedAt || data.edited_at));
}

function getMessageId(data) {
  return data && data.id != null ? String(data.id) : '';
}

function getMessageText(data) {
  return String((data && (data.message || data.body)) || '');
}

function appendChatMessage(data) {
  const messageText = getMessageText(data);
  if (!messageText) return;

  const messageId = getMessageId(data);

  if (messageId && renderedMessageIds.has(messageId)) {
    return;
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-placeholder';

  if (messageId) {
    messageDiv.dataset.messageId = messageId;
    renderedMessageIds.add(messageId);
  }

  const channelId = getMessageChannelId(data);
  const userId = data && data.userId != null ? String(data.userId) : '';

  messageDiv.dataset.channelId = String(channelId);
  messageDiv.dataset.userId = userId;
  messageDiv.dataset.messageText = messageText;

  const username = data.username || 'anonymous';

  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-header';

  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'username-placeholder';
  usernameSpan.textContent = username;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = formatMessageTime(data.createdAt || data.created_at);

  const textSpan = document.createElement('div');
  textSpan.className = 'text';

  const messageTextSpan = document.createElement('span');
  messageTextSpan.className = 'message-text';
  messageTextSpan.textContent = messageText;

  const editedSpan = document.createElement('span');
  editedSpan.className = 'message-edited';
  editedSpan.textContent = 'edited';
  editedSpan.hidden = !hasEditedMarker(data);

  textSpan.appendChild(messageTextSpan);
  textSpan.appendChild(editedSpan);

  headerDiv.appendChild(usernameSpan);
  headerDiv.appendChild(timeSpan);
  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(textSpan);
  messageDiv.oncontextmenu = (event) => openMessageContextMenu(event, {
    id: messageId,
    channelId,
    userId,
    message: messageText
  });
  messageArea.appendChild(messageDiv);
  trimVisibleMessages();
  messageArea.scrollTop = messageArea.scrollHeight;
}

function updateRenderedMessage(data) {
  const messageId = getMessageId(data);
  if (!messageId || getMessageChannelId(data) !== currentChannelId) return;

  const messageEl = messageArea.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;

  const messageText = getMessageText(data);
  const messageTextEl = messageEl.querySelector('.message-text');
  const editedEl = messageEl.querySelector('.message-edited');

  if (messageTextEl) {
    messageTextEl.textContent = messageText;
  }

  if (editedEl) {
    editedEl.hidden = !hasEditedMarker(data);
  }

  messageEl.dataset.messageText = messageText;
  messageEl.oncontextmenu = (event) => openMessageContextMenu(event, {
    id: messageId,
    channelId: getMessageChannelId(data),
    userId: data && data.userId,
    message: messageText
  });
}

function removeRenderedMessage(data) {
  const messageId = getMessageId(data);
  if (!messageId || getMessageChannelId(data) !== currentChannelId) return;

  const messageEl = messageArea.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;

  renderedMessageIds.delete(messageId);
  messageEl.remove();
}

function renderMessageList(messages) {
  messageArea.innerHTML = '';
  resetRenderedMessageIds();
  messages.slice(-MAX_VISIBLE_MESSAGES).forEach(appendChatMessage);
  messageArea.scrollTop = messageArea.scrollHeight;
}

function loadChannelMessages(channelId) {
  const requestId = ++messageLoadRequestId;
  isLoadingMessages = true;
  queuedLiveMessages = [];
  messageArea.innerHTML = '';
  resetRenderedMessageIds();

  window.chatAPI.loadMessages(channelId, (res) => {
    if (requestId !== messageLoadRequestId || channelId !== currentChannelId) {
      return;
    }

    if (!res || !res.success) {
      console.log((res && res.error) || 'Could not load messages');
      queuedLiveMessages = [];
      isLoadingMessages = false;
      return;
    }

    renderMessageList(res.messages || []);

    const liveMessages = queuedLiveMessages;
    queuedLiveMessages = [];

    liveMessages.forEach((messageData) => {
      if (getMessageChannelId(messageData) === currentChannelId) {
        appendChatMessage(messageData);
      }
    });

    isLoadingMessages = false;
  });
}

function switchChannel(channelId) {
  currentChannelId = parseChannelId(channelId);
  document.querySelectorAll('.channel').forEach((c) => c.classList.remove('active'));

  const activeEl = document.querySelector(`[data-channel-id="${currentChannelId}"]`);
  if (activeEl) activeEl.classList.add('active');

  loadChannelMessages(currentChannelId);
}

function renderChannels(data) {
  const container = document.getElementById('dynamic-channels');
  const previousChannelId = currentChannelId;

  textChannels = data.channels || [];

  if (!textChannels.some((channel) => parseChannelId(channel.id, 0) === currentChannelId)) {
    currentChannelId = textChannels.length > 0
      ? parseChannelId(textChannels[0].id, DEFAULT_CHANNEL_ID)
      : DEFAULT_CHANNEL_ID;
  }

  container.innerHTML = '';

  textChannels.forEach((channel) => {
    const channelEl = document.createElement('div');
    channelEl.className = 'channel';

    if (parseChannelId(channel.id) === currentChannelId) channelEl.classList.add('active');

    channelEl.textContent = `# ${channel.name}`;
    channelEl.dataset.channelId = channel.id;
    channelEl.onclick = () => switchChannel(channel.id);
    channelEl.oncontextmenu = (event) => openChannelContextMenu(event, 'text', channel);

    container.appendChild(channelEl);
  });

  if (previousChannelId !== currentChannelId && currentUserId) {
    loadChannelMessages(currentChannelId);
  }
}

window.chatAPI.onNewChannel(renderChannels);

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const messageText = messageInput.value.trim();
  if (!messageText) return;

  if (!currentUserId) {
    alert('Log in before sending messages');
    return;
  }

  window.chatAPI.sendMessage({
    message: messageText,
    channelId: currentChannelId
  }, (res) => {
    if (!res || !res.success) {
      console.log((res && res.error) || 'Message could not be sent');
      messageInput.value = messageText;
    }
  });

  messageInput.value = '';
});



// chat messages
window.chatAPI.onMessage((data) => {
  if (getMessageChannelId(data) !== currentChannelId) return;

  if (isLoadingMessages) {
    queuedLiveMessages.push(data);
    return;
  }

  appendChatMessage(data);
});

window.chatAPI.onMessageEdited((data) => {
  updateRenderedMessage(data);
});

window.chatAPI.onMessageDeleted((data) => {
  removeRenderedMessage(data);
});

// Voice channels
const voiceModal = document.getElementById('voice-channel-modal');
const voiceChannelModalTitle = document.getElementById('voice-channel-modal-title');
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
  /* App Background
  {key: 'appBg', label: 'App Background', cssVar: '--app-bg', defaultColor: '#222222'},
  */
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
let voiceChannelModalMode = 'create';
let editingVoiceChannelId = null;

voiceModal.style.display = 'none';
voiceSettingsModal.style.display = 'none';

function openVoiceChannelModal(mode = 'create', channel = null) {
  voiceChannelModalMode = mode;
  editingVoiceChannelId = channel ? parseChannelId(channel.id, 0) : null;
  voiceChannelModalTitle.textContent = mode === 'edit' ? 'Edit Voice Channel' : 'Create Voice Channel';
  confirmVoiceBtn.textContent = mode === 'edit' ? 'Save' : 'Create';
  voiceModal.style.display = 'flex';
  voiceChannelInput.value = channel ? channel.name : '';
  voiceChannelInput.placeholder = 'New Voice Chat';
  voiceChannelInput.focus();
  voiceChannelInput.select();
}

function closeVoiceChannelModal() {
  voiceModal.style.display = 'none';
  voiceChannelInput.value = '';
  voiceChannelModalMode = 'create';
  editingVoiceChannelId = null;
}

addVoiceBtn.onclick = () => {
  openVoiceChannelModal('create');
};

cancelVoiceBtn.onclick = () => {
  closeVoiceChannelModal();
};

confirmVoiceBtn.onclick = () => {
  const name = voiceChannelInput.value.trim();
  if (!name) return;

  const finish = (res) => {
    if (res.success) {
      closeVoiceChannelModal();
    } else {
      alert(res.error || 'Error saving voice channel');
    }
  };

  if (voiceChannelModalMode === 'edit') {
    window.chatAPI.editVoiceChannel({channelId: editingVoiceChannelId, name}, finish);
    return;
  }

  window.chatAPI.createVoiceChannel(name, finish);
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
  const activeVoiceChannel = currentVoiceChannelId
    ? voiceChannels.find((channel) => parseChannelId(channel.id, 0) === currentVoiceChannelId)
    : null;

  if (currentVoiceChannelId && !activeVoiceChannel) {
    closeAllPeerConnections();
    stopLocalStream();
    currentVoiceChannelId = null;
    currentVoiceChannelName = '';
    currentVoiceSocketId = null;
    isVoiceDeafened = false;
    updateRemoteAudioMutedState();
    updateVoiceControls();
  } else if (activeVoiceChannel && currentVoiceChannelName !== activeVoiceChannel.name) {
    currentVoiceChannelName = activeVoiceChannel.name;
    updateVoiceControls();
  }

  voiceChannelsContainer.innerHTML = '';

  voiceChannels.forEach((channel) => {
    const channelId = parseChannelId(channel.id, 0);
    const users = voiceUsersByChannel[channel.id] || voiceUsersByChannel[channelId] || [];
    const channelEl = document.createElement('div');
    channelEl.className = 'voice-channel';
    if (channelId === currentVoiceChannelId) {
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

    if (channelId === currentVoiceChannelId && users.length > 0) {
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

    channelEl.onclick = () => joinVoiceChannel(channelId);
    channelEl.oncontextmenu = (event) => openChannelContextMenu(event, 'voice', {
      ...channel,
      id: channelId
    });
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

  closeChannelContextMenu();
  closeMessageContextMenu();
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
    window.chatAPI.joinVoice({channelId}, resolve);
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
  channelId = parseChannelId(channelId, 0);

  if (!currentUserId) {
    alert('Log in before joining voice');
    return;
  }

  const channel = voiceChannels.find((voiceChannel) => parseChannelId(voiceChannel.id, 0) === channelId);
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
    const data = await window.chatAPI.signup({ username, email, password });
    signupMessage.innerText = data.message || data.error || '';

    if (data.success) {
      signupModal.style.display = 'none';
      signupForm.reset();
      applyAuthenticatedUser(data.user);
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
  if (currentUserId) {
    logoutCurrentUser();
    return;
  }

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
    const data = await window.chatAPI.login({ email, password });
    loginMessage.innerText = data.message || data.error || '';

    if (data.success) {
      loginModal.style.display = 'none';
      loginForm.reset();
      applyAuthenticatedUser(data.user);
    }
  } catch (err) {
    console.log(err);
    loginMessage.innerText = 'Server error';
  }
});

async function logoutCurrentUser() {
  if (currentVoiceChannelId) {
    await leaveVoiceChannel();
  }

  await window.chatAPI.logout();
  clearAuthenticatedUser();
}

async function initializeSession() {
  updateAuthControls();

  const session = await window.chatAPI.restoreSession();

  if (session.success) {
    applyAuthenticatedUser(session.user);
  }
}

initializeSession();
