const information = document.getElementById('info')
information.innerText = `This app is using Chrome (v${window.versions.chrome()}), Node.js (v${window.versions.node()}), and Electron (v${window.versions.electron()})`;

//input chat message and display in message area
let message;

const form = document.getElementById('form');
const messageInput = document.getElementById('message');
const messageArea = document.getElementById('messageArea');

let currentChannelId = 1;

const modal = document.getElementById('channel-modal');
const channelInput = document.getElementById('channel-name-input');
const addBtn = document.getElementById('add-channel-btn');
const confirmBtn = document.getElementById('create-channel-confirm');
const cancelBtn = document.getElementById('create-channel-cancel');

// hidden on startup
modal.style.display = 'none';

// create channel modal logic
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
  if (name) {
    window.chatAPI.sendChannel(name, (res) => {
      if (res.success) {
        modal.style.display = 'none';
        channelInput.value = '';
      } else {
        alert(res.error || 'Error creating channel');
      }
    });
  }
};

function switchChannel(channelId) {
  currentChannelId = channelId;
  document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
  const activeEl = document.querySelector(`[data-channel-id="${channelId}"]`);
  if (activeEl) activeEl.classList.add('active');
  messageArea.innerHTML = '';
}

function renderChannels(data) {
  const container = document.getElementById('dynamic-channels');
  container.innerHTML = '';
  data.channels.forEach(channel => {
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
    message: messageText,
    channelId: currentChannelId
  });
  messageInput.value = '';
});
// chat messages
window.chatAPI.onMessage((data) => {
  if (data.channelId && parseInt(data.channelId) !== currentChannelId) {
    return;
  }
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-placeholder';
  const username = 'asian'; // placeholder username // change later when doing server 

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
  
  messageInput.value = ''; // Clear the input field after sending

});