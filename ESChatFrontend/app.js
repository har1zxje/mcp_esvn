const API_BASE_URL = window.ES_API_BASE_URL || window.VFI_API_BASE_URL || 'http://localhost:4000/api';
const messages = document.querySelector('#messages');
const welcome = document.querySelector('#welcome');
const input = document.querySelector('#messageInput');
const composer = document.querySelector('#composer');
const status = document.querySelector('#connectionStatus');
let conversationId = null;

const chats = ['Hôm nay tôi có gì cần xử lý?', 'Tóm tắt dự án ERP', 'Soạn email cho khách hàng', 'Biên bản cuộc họp 12/09', 'Báo cáo tiến độ tuần', 'Chính sách nghỉ phép', 'Phân tích dữ liệu kinh doanh', 'Tìm tài liệu quy trình'];
const chatList = document.querySelector('#chatList');
chatList.innerHTML = '<div class="chat-section">Today</div>' + chats.slice(0, 4).map((chat, i) => `<div class="chat-item ${i === 0 ? 'active' : ''}">▧ &nbsp;${chat}</div>`).join('') + '<div class="chat-section">Yesterday</div>' + chats.slice(4, 6).map(chat => `<div class="chat-item">▧ &nbsp;${chat}</div>`).join('') + '<div class="chat-section">Last 7 days</div>' + chats.slice(6).map(chat => `<div class="chat-item">▧ &nbsp;${chat}</div>`).join('');

function addMessage(text, role) {
  welcome.hidden = true;
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

async function sendMessage(text) {
  addMessage(text, 'user');
  input.value = '';
  input.style.height = 'auto';
  status.textContent = 'Đang xử lý...';
  const assistant = addMessage('', 'assistant');
  try {
    const response = await fetch(`${API_BASE_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, conversationId }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '';
      while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() || ''; events.forEach(event => event.split('\n').filter(line => line.startsWith('data:')).forEach(line => { try { const data = JSON.parse(line.slice(5).trim()); const text = data.token || data.content || data.text || data.response || (typeof data.message === 'string' ? data.message : ''); if (text) assistant.textContent += text; conversationId = data.conversationId || data.conversation_id || conversationId; } catch { /* Ignore non-JSON keep-alive events. */ } })); }
    } else { const data = await response.json(); assistant.textContent = data.text || data.content || data.message || 'Đã nhận phản hồi.'; conversationId = data.conversationId || conversationId; }
  } catch (error) {
    assistant.textContent = 'Chưa kết nối được backend. Hãy kiểm tra API proxy tại ' + API_BASE_URL + '/chat.';
    console.error(error);
  } finally { status.textContent = 'Sẵn sàng'; }
}

composer.addEventListener('submit', event => { event.preventDefault(); const text = input.value.trim(); if (text) sendMessage(text); });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; document.querySelector('.send-button').classList.toggle('ready', Boolean(input.value.trim())); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); } });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.prompt; input.dispatchEvent(new Event('input')); input.focus(); }));
document.querySelector('#newChatButton').addEventListener('click', () => { messages.innerHTML = ''; welcome.hidden = false; conversationId = null; input.focus(); });
