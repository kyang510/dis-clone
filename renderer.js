const information = document.getElementById('info')
information.innerText = `This app is using Chrome (v${window.versions.chrome()}), Node.js (v${window.versions.node()}), and Electron (v${window.versions.electron()})`;

//input chat message and display in message area
let message;

const form = document.getElementById('form');
const messageInput = document.getElementById('message');
const messageArea = document.getElementById('messageArea');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = messageInput.value; 
  if (message.trim() === '') return;
  console.log('Message sent:', message);
  
  // Create new message element
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message-placeholder';
  
  const username = 'Asian'; // Placeholder username
  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'username-placeholder';
  usernameSpan.textContent = `${username}: `;
  
  const textSpan = document.createElement('span');
  textSpan.className = 'text';
  textSpan.textContent = message;
  
  messageDiv.appendChild(usernameSpan);
  messageDiv.appendChild(textSpan);
  
  messageArea.appendChild(messageDiv);
  
  messageArea.scrollTop = messageArea.scrollHeight;
  
  messageInput.value = '';
});
