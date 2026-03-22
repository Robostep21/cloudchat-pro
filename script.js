// ==================== ИНИЦИАЛИЗАЦИЯ ====================
let socket = null;
let currentUser = null;
let currentChatId = null;
let currentGroupId = null;
let chats = new Map();
let groups = new Map();
let users = [];
let peerConnection = null;
let localStream = null;
let currentCallId = null;
let callTimeout = null;

console.log('✅ Скрипт загружен');

// ==================== СИСТЕМА ЗАПОМИНАНИЯ ====================
const SESSION_KEY = 'cloudchat_session';
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 дней

function saveSession(username) {
    const sessionData = {
        username: username,
        timestamp: Date.now(),
        expiry: Date.now() + SESSION_EXPIRY
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    console.log('✅ Сессия сохранена для:', username);
}

function getSession() {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;

    try {
        const session = JSON.parse(saved);
        
        if (Date.now() > session.expiry) {
            console.log('❌ Сессия истекла');
            clearSession();
            return null;
        }

        console.log('✅ Сессия найдена:', session.username);
        return session;
    } catch (e) {
        console.error('Ошибка сессии:', e);
        return null;
    }
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    console.log('✅ Сессия очищена');
}

// ==================== ПРОВЕРКА СЕССИИ ПРИ ЗАГРУЗКЕ ====================
window.addEventListener('DOMContentLoaded', () => {
    console.log('🔍 Проверка сохраненной сессии...');
    
    const session = getSession();
    if (session) {
        console.log('✅ Найдена сохраненная сессия, автоматический вход...');
        login(session.username);
    } else {
        console.log('❌ Сохраненная сессия не найдена');
        document.getElementById('authScreen').classList.add('active');
    }
});

// ==================== КРАСИВЫЕ МОДАЛЬНЫЕ ОКНА ====================
function showAlert(title, message, icon = 'ℹ️') {
    const modal = document.getElementById('alertModal');
    document.getElementById('alertIcon').textContent = icon;
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMessage').textContent = message;
    modal.classList.remove('hidden');

    return new Promise(resolve => {
        const btn = document.getElementById('alertBtn');
        const handler = () => {
            modal.classList.add('hidden');
            btn.removeEventListener('click', handler);
            resolve();
        };
        btn.addEventListener('click', handler);
    });
}

function showConfirm(title, message) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    modal.classList.remove('hidden');

    return new Promise(resolve => {
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        const handleYes = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            resolve(true);
        };

        const handleNo = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
            resolve(false);
        };

        yesBtn.addEventListener('click', handleYes);
        noBtn.addEventListener('click', handleNo);
    });
}

function showPrompt(title, placeholder = 'Текст...') {
    const modal = document.getElementById('promptModal');
    const input = document.getElementById('promptInput');
    document.getElementById('promptTitle').textContent = title;
    input.placeholder = placeholder;
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    return new Promise(resolve => {
        const okBtn = document.getElementById('promptOk');
        const cancelBtn = document.getElementById('promptCancel');

        const handleOk = () => {
            const value = input.value.trim();
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(value || null);
        };

        const handleCancel = () => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(null);
        };

        const handleKeypress = (e) => {
            if (e.key === 'Enter') {
                handleOk();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keypress', handleKeypress);
    });
}

// ==================== АВТОРИЗАЦИЯ ====================
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
}

document.getElementById('loginBtn').addEventListener('click', async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    if (!username || !password) {
        await showAlert('Ошибка', 'Заполни все поля!', '⚠️');
        return;
    }

    try {
        const res = await fetch('https://cloudchat-pro.vercel.app/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (data.success) {
            if (rememberMe) {
                saveSession(username);
            }
            
            await showAlert('Добро пожаловать!', `Вы вошли как @${username}`, '✅');
            login(username);
        } else {
            await showAlert('Ошибка входа', data.error || 'Неверные данные', '❌');
        }
    } catch (e) {
        await showAlert('Ошибка сервера', e.message, '❌');
    }
});

document.getElementById('registerBtn').addEventListener('click', async () => {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;

    if (!username || !password || !password2) {
        await showAlert('Ошибка', 'Заполни все поля!', '⚠️');
        return;
    }

    if (password !== password2) {
        await showAlert('Ошибка', 'Пароли не совпадают!', '⚠️');
        return;
    }

    if (username.length < 3 || username.length > 20) {
        await showAlert('Ошибка', 'Username: 3-20 символов', '⚠️');
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (data.success) {
            await showAlert('Успех!', `Аккаунт @${username} создан! Теперь войди`, '✅');
            switchAuthTab('login');
            document.getElementById('loginUsername').value = username;
        } else {
            await showAlert('Ошибка регистрации', data.error || 'Неизвестная ошибка', '❌');
        }
    } catch (e) {
        await showAlert('Ошибка сервера', e.message, '❌');
    }
});

function login(username) {
    currentUser = username;
    console.log('✅ Вошёл как:', username);

    document.getElementById('authScreen').classList.remove('active');
    document.getElementById('currentUsername').textContent = '@' + username;

    connectSocket();

    setTimeout(() => {
        loadUsers();
        loadChats();
        loadGroups();
    }, 500);
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    const confirmed = await showConfirm('Выход', 'Вы уверены что хотите выйти?');
    
    if (confirmed) {
        clearSession();
        
        if (socket) socket.disconnect();
        
        currentUser = null;
        currentChatId = null;
        currentGroupId = null;
        chats.clear();
        groups.clear();

        document.getElementById('authScreen').classList.add('active');
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
        document.getElementById('rememberMe').checked = false;
        
        await showAlert('Вы вышли', 'До встречи!', '👋');
    }
});

// ==================== WEBSOCKET ====================
function connectSocket() {
    if (socket) socket.disconnect();
    
    socket = io();

    socket.on('connect', () => {
        console.log('✅ WebSocket подключен');
        socket.emit('user:login', currentUser);
    });

    socket.on('disconnect', () => {
        console.log('❌ WebSocket отключен');
    });

    socket.on('user:status', (data) => {
        const user = users.find(u => u.username === data.username);
        if (user) user.status = data.status;
        renderUsers();
    });

    socket.on('message:receive', (msg) => {
        const chatId = [currentUser, msg.from].sort().join('-');
        if (chats.has(chatId)) {
            chats.get(chatId).messages.push(msg);
            if (currentChatId === chatId) {
                renderMessages();
            }
        }
    });

    let lastGroupMessageId = {};
    socket.on('group:message:receive', (msg) => {
        if (lastGroupMessageId[msg.groupId] === msg.id) return;
        lastGroupMessageId[msg.groupId] = msg.id;

        if (groups.has(msg.groupId)) {
            const group = groups.get(msg.groupId);
            if (!group.messages.some(m => m.id === msg.id)) {
                group.messages.push(msg);
            }
            if (currentGroupId === msg.groupId) {
                renderMessages();
            }
        }
    });

    // ========== ЗВОНКИ ==========
    // Входящий звонок
    socket.on('call:incoming', (data) => {
        console.log('📱 Входящий звонок:', data);
        showIncomingCall(data);
    });

    // Собеседник принял звонок
    socket.on('call:answered', (data) => {
        console.log('✅ Звонок принят!');
        clearTimeout(callTimeout);
        document.getElementById('waitingCallModal').classList.add('hidden');
        document.getElementById('callModal').classList.remove('hidden');
        startCallTimer();
    });

    // Собеседник отклонил звонок
    socket.on('call:rejected', async (data) => {
        console.log('❌ Звонок отклонен');
        clearTimeout(callTimeout);
        document.getElementById('waitingCallModal').classList.add('hidden');
        await showAlert('Звонок отклонен', 'Собеседник отклонил звонок', '❌');
        closeCall();
    });

    // Звонок завершен
    socket.on('call:ended', (data) => {
        console.log('📞 Звонок завершен');
        clearTimeout(callTimeout);
        document.getElementById('callModal').classList.add('hidden');
        document.getElementById('waitingCallModal').classList.add('hidden');
        closeCall();
    });
}

// ==================== ЗАГРУЗКА ДАННЫХ ====================
async function loadUsers() {
    try {
        const res = await fetch('/api/users');
        users = await res.json();
        users = users.filter(u => u.username !== currentUser);
        console.log('✅ Пользователи:', users.length);
        renderUsers();
    } catch (e) {
        console.error('Ошибка:', e);
    }
}

function loadChats() {
    const saved = localStorage.getItem(`chats_${currentUser}`);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            chats = new Map(data);
        } catch (e) {
            console.error('Ошибка загрузки чатов:', e);
        }
    }
    renderChats();
}

async function loadGroups() {
    try {
        const res = await fetch(`/api/groups/${currentUser}`);
        const data = await res.json();
        groups.clear();
        data.forEach(g => {
            groups.set(g.id, {
                id: g.id,
                name: g.name,
                members: g.members,
                messages: g.messages || []
            });
        });
        renderGroups();
    } catch (e) {
        console.error('Ошибка:', e);
    }
}

// ==================== ОТОБРАЖЕНИЕ ====================
function renderUsers() {
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';

    users.forEach(user => {
        const btn = document.createElement('button');
        btn.className = 'chat-item';
        btn.innerHTML = `
            <div class="chat-item-avatar">👤</div>
            <div class="chat-item-info">
                <div class="chat-item-name">@${user.username}</div>
                <div class="chat-item-status">${user.status === 'online' ? '● В сети' : '○ Оффлайн'}</div>
            </div>
        `;
        btn.addEventListener('click', () => startDirectChat(user.username));
        usersList.appendChild(btn);
    });
}

function renderChats() {
    const chatsList = document.getElementById('chatsList');
    chatsList.innerHTML = '';

    chats.forEach((chat, chatId) => {
        const otherUser = chat.participants.find(p => p !== currentUser);
        const btn = document.createElement('button');
        btn.className = 'chat-item' + (currentChatId === chatId ? ' active' : '');
        btn.dataset.chatId = chatId;
        btn.innerHTML = `
            <div class="chat-item-avatar">👤</div>
            <div class="chat-item-info">
                <div class="chat-item-name">@${otherUser}</div>
                <div class="chat-item-status">${chat.messages.length} сообщений</div>
            </div>
        `;
        btn.addEventListener('click', () => selectChat(chatId));
        
        // Правый клик на чат
        btn.addEventListener('contextmenu', (e) => {
            showChatContextMenu(e, chatId);
        });
        
        chatsList.appendChild(btn);
    });
}

function renderGroups() {
    const groupsList = document.getElementById('groupsList');
    groupsList.innerHTML = '';

    groups.forEach((group, groupId) => {
        const btn = document.createElement('button');
        btn.className = 'chat-item' + (currentGroupId === groupId ? ' active' : '');
        btn.dataset.groupId = groupId;
        btn.innerHTML = `
            <div class="chat-item-avatar">👥</div>
            <div class="chat-item-info">
                <div class="chat-item-name">${group.name}</div>
                <div class="chat-item-status">${group.members.length} участников</div>
            </div>
        `;
        btn.addEventListener('click', () => selectGroup(groupId));
        groupsList.appendChild(btn);
    });
}

function renderMessages() {
    const container = document.getElementById('messagesContainer');
    const messages = currentChatId 
        ? chats.get(currentChatId)?.messages || []
        : groups.get(currentGroupId)?.messages || [];

    container.innerHTML = '';

    if (messages.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-text">Нет сообщений</div></div>';
        return;
    }

    messages.forEach((msg, index) => {
        const msgEl = document.createElement('div');
        msgEl.className = 'message ' + (msg.from === currentUser ? 'sent' : 'received');
        msgEl.dataset.messageIndex = index;
        
        const time = new Date(msg.timestamp).toLocaleTimeString('ru', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        msgEl.innerHTML = `
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-time">${time}</div>
        `;
        
        // Правый клик на сообщение
        msgEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e, index);
        });
        
        container.appendChild(msgEl);
    });

    container.scrollTop = container.scrollHeight;
}

// ==================== КОНТЕКСТНОЕ МЕНЮ ====================
function showMessageContextMenu(e, messageIndex) {
    const menu = document.getElementById('messageContextMenu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('active');
    menu.dataset.messageIndex = messageIndex;
}

function showChatContextMenu(e, chatId) {
    e.preventDefault();
    e.stopPropagation();
    const menu = document.getElementById('chatContextMenu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('active');
    menu.dataset.chatId = chatId;
}

// Обработчики контекстного меню сообщений
document.querySelectorAll('#messageContextMenu .context-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
        const action = e.target.dataset.action;
        const menu = document.getElementById('messageContextMenu');
        const messageIndex = parseInt(menu.dataset.messageIndex);
        
        if (currentChatId) {
            const messages = chats.get(currentChatId).messages;
            const msg = messages[messageIndex];
            
            if (action === 'pin') {
                await showAlert('📌 Закрепить', 'Закрепление в личных чатах пока не реализовано', 'ℹ️');
            } else if (action === 'copy') {
                await navigator.clipboard.writeText(msg.content);
                await showAlert('✓ Скопировано', 'Сообщение скопировано в буфер обмена', '✅');
            } else if (action === 'delete') {
                const confirmed = await showConfirm('Удалить сообщение', 'Это действие нельзя отменить');
                if (confirmed) {
                    messages.splice(messageIndex, 1);
                    saveChats();
                    renderMessages();
                }
            }
        } else if (currentGroupId) {
            const messages = groups.get(currentGroupId).messages;
            const msg = messages[messageIndex];
            
            if (action === 'pin') {
                await showAlert('📌 Закрепить', 'Закрепление в группах пока не реализовано', 'ℹ️');
            } else if (action === 'copy') {
                await navigator.clipboard.writeText(msg.content);
                await showAlert('✓ Скопировано', 'Сообщение скопировано в буфер обмена', '✅');
            } else if (action === 'delete' && msg.from === currentUser) {
                const confirmed = await showConfirm('Удалить сообщение', 'Это действие нельзя отменить');
                if (confirmed) {
                    messages.splice(messageIndex, 1);
                    renderMessages();
                }
            } else if (action === 'delete') {
                await showAlert('Ошибка', 'Можешь удалить только свои сообщения', '⚠️');
            }
        }
        
        menu.classList.remove('active');
    });
});

// Обработчики контекстного меню чатов
document.querySelectorAll('#chatContextMenu .context-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
        const action = e.target.dataset.action;
        const menu = document.getElementById('chatContextMenu');
        const chatId = menu.dataset.chatId;
        
        if (action === 'clear') {
            const confirmed = await showConfirm('Очистить чат', 'Все сообщения будут удалены!');
            if (confirmed) {
                if (chats.has(chatId)) {
                    chats.get(chatId).messages = [];
                    saveChats();
                    renderMessages();
                    await showAlert('✓ Очищено', 'Чат очищен', '✅');
                }
            }
        } else if (action === 'deleteChat') {
            const confirmed = await showConfirm('Удалить чат', 'Чат будет полностью удален!');
            if (confirmed) {
                chats.delete(chatId);
                saveChats();
                renderChats();
                document.getElementById('messagesContainer').innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-text">Выбери чат или создай новый</div></div>';
                await showAlert('✓ Удалено', 'Чат удален', '✅');
            }
        }
        
        menu.classList.remove('active');
    });
});

// Закрытие контекстного меню при клике вне его
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        document.getElementById('messageContextMenu').classList.remove('active');
        document.getElementById('chatContextMenu').classList.remove('active');
    }
});

// ==================== ЧАТЫ ====================
function startDirectChat(username) {
    const chatId = [currentUser, username].sort().join('-');
    
    if (!chats.has(chatId)) {
        chats.set(chatId, {
            id: chatId,
            participants: [currentUser, username],
            messages: []
        });
        saveChats();
    }

    selectChat(chatId);
}

function selectChat(chatId) {
    currentChatId = chatId;
    currentGroupId = null;

    const chat = chats.get(chatId);
    const otherUser = chat.participants.find(p => p !== currentUser);

    document.getElementById('chatName').textContent = '@' + otherUser;
    document.getElementById('chatStatus').textContent = 'Прямое сообщение';

    document.querySelectorAll('[data-chatId]').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-chatId="${chatId}"]`)?.classList.add('active');

    renderMessages();
}

function selectGroup(groupId) {
    currentChatId = null;
    currentGroupId = groupId;

    const group = groups.get(groupId);

    document.getElementById('chatName').textContent = group.name;
    document.getElementById('chatStatus').textContent = `${group.members.length} участников`;

    document.querySelectorAll('[data-groupId]').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-groupId="${groupId}"]`)?.classList.add('active');

    renderMessages();
}

// ==================== СООБЩЕНИЯ ====================
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;

    if (currentChatId) {
        const chat = chats.get(currentChatId);
        const otherUser = chat.participants.find(p => p !== currentUser);

        const msg = {
            id: Date.now().toString(),
            from: currentUser,
            to: otherUser,
            content,
            timestamp: new Date().toISOString()
        };

        chat.messages.push(msg);
        saveChats();

        if (socket) {
            socket.emit('message:send', {
                from: currentUser,
                to: otherUser,
                content,
                type: 'text'
            });
        }

        renderMessages();

    } else if (currentGroupId) {
        const group = groups.get(currentGroupId);

        const msg = {
            id: Date.now().toString() + Math.random(),
            from: currentUser,
            content,
            timestamp: new Date().toISOString()
        };

        group.messages.push(msg);

        if (socket) {
            socket.emit('group:message:send', {
                groupId: currentGroupId,
                from: currentUser,
                content
            });
        }

        renderMessages();
    }

    messageInput.value = '';
}

function saveChats() {
    localStorage.setItem(`chats_${currentUser}`, JSON.stringify(Array.from(chats.entries())));
}

// ==================== ГРУППЫ ====================
document.getElementById('newGroupBtn').addEventListener('click', async () => {
    const groupName = await showPrompt('Создать группу', 'Название группы...');
    if (!groupName) return;

    const membersStr = await showPrompt('Участники', 'usernames через запятую (кроме себя)');
    if (!membersStr && membersStr !== '') return;

    const members = [currentUser, ...(membersStr?.split(',').map(m => m.trim()).filter(m => m) || [])];

    try {
        const res = await fetch('/api/groups/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: groupName,
                members,
                createdBy: currentUser
            })
        });

        const data = await res.json();
        if (data.success) {
            groups.set(data.groupId, {
                id: data.groupId,
                name: groupName,
                members,
                messages: []
            });
            renderGroups();
            await showAlert('Успех!', `Группа "${groupName}" создана!`, '✅');
        }
    } catch (e) {
        await showAlert('Ошибка', e.message, '❌');
    }
});

document.getElementById('newChatBtn').addEventListener('click', async () => {
    const username = await showPrompt('Новый чат', 'username (без @)');
    if (!username) return;

    if (username === currentUser) {
        await showAlert('Ошибка', 'Нельзя писать себе!', '⚠️');
        return;
    }

    startDirectChat(username);
});

// ==================== ЗВОНКИ ====================
document.getElementById('audioCallBtn').addEventListener('click', () => initCall('audio'));
document.getElementById('videoCallBtn').addEventListener('click', () => initCall('video'));

async function initCall(type) {
    if (!currentChatId) {
        await showAlert('Ошибка', 'Выбери чат для звонка!', '⚠️');
        return;
    }

    const otherUser = chats.get(currentChatId).participants.find(p => p !== currentUser);

    try {
        const constraints = {
            audio: true,
            video: type === 'video'
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        if (socket) {
            currentCallId = Date.now().toString();
            socket.emit('call:initiate', {
                callId: currentCallId,
                from: currentUser,
                to: otherUser,
                type
            });
        }

        // Показываем окно ОЖИДАНИЯ ответа
        document.getElementById('waitingCallWith').textContent = 
            `Вызов @${otherUser}...`;
        document.getElementById('waitingCallType').textContent = 
            type === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
        document.getElementById('waitingCallModal').classList.remove('hidden');

        // Таймаут 60 секунд - если нет ответа, отменяем
        callTimeout = setTimeout(() => {
            if (currentCallId) {
                document.getElementById('waitingCallModal').classList.add('hidden');
                showAlert('Время вышло', 'Нет ответа на звонок', '⏱️');
                if (socket) socket.emit('call:end', { callId: currentCallId });
                closeCall();
            }
        }, 60000);

    } catch (error) {
        await showAlert('Ошибка', 'Доступ запрещен: ' + error.message, '❌');
    }
}

// Входящий звонок - показываем запрос
function showIncomingCall(data) {
    console.log('📱 Показываю входящий звонок');
    
    // Включаем рингтон
    const ringtone = document.getElementById('ringtone');
    ringtone.currentTime = 0;
    ringtone.play().catch(e => console.log('Ошибка воспроизведения рингтона:', e));
    
    document.getElementById('incomingCaller').textContent = `@${data.from} вызывает...`;
    document.getElementById('incomingType').textContent = 
        data.type === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
    document.getElementById('incomingCallModal').classList.remove('hidden');

    // Ответить на звонок
    document.getElementById('acceptCallBtn').onclick = async () => {
        // Останавливаем рингтон
        ringtone.pause();
        
        try {
            const constraints = {
                audio: true,
                video: data.type === 'video'
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            await showAlert('Ошибка', 'Доступ запрещен: ' + e.message, '❌');
            return;
        }

        if (socket) socket.emit('call:answer', { callId: data.callId });
        document.getElementById('incomingCallModal').classList.add('hidden');
        document.getElementById('callModal').classList.remove('hidden');
        startCallTimer();
    };

    // Отклонить звонок
    document.getElementById('rejectCallBtn').onclick = () => {
        // Останавливаем рингтон
        ringtone.pause();
        
        if (socket) socket.emit('call:reject', { callId: data.callId });
        document.getElementById('incomingCallModal').classList.add('hidden');
    };
}

// Таймер звонка
function startCallTimer() {
    let seconds = 0;
    const timer = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const durationEl = document.getElementById('callDuration');
        if (durationEl) {
            durationEl.textContent = 
                `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }, 1000);
}

// Кнопка отмены звонка в ожидании
document.getElementById('cancelCall').addEventListener('click', () => {
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    
    clearTimeout(callTimeout);
    document.getElementById('waitingCallModal').classList.add('hidden');
    if (socket && currentCallId) socket.emit('call:end', { callId: currentCallId });
    closeCall();
});

// Кнопка завершить звонок
document.getElementById('endCall').addEventListener('click', () => {
    if (socket && currentCallId) socket.emit('call:end', { callId: currentCallId });
    closeCall();
});

function closeCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Останавливаем рингтон если он включен
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    
    document.getElementById('callModal').classList.add('hidden');
    document.getElementById('incomingCallModal').classList.add('hidden');
    document.getElementById('waitingCallModal').classList.add('hidden');
    currentCallId = null;
}

// ==================== ТЕМА ====================
document.getElementById('themeBtn').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
    document.getElementById('themeBtn').textContent = 
        document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
});

if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.getElementById('themeBtn').textContent = '☀️';
}

// ==================== ВКЛАДКИ ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(tabName + 'Tab').classList.add('active');
    });
});

// ==================== УТИЛИТЫ ====================
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}

console.log('✅ Инициализация завершена');
