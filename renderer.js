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
      currentUsername = data.username || currentUsername;
      loginModal.style.display = 'none';
      loginForm.reset();
    }
  } catch (err) {
    console.log(err);
    loginMessage.innerText = 'Server error';
  }
});

