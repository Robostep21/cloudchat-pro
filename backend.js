const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Хранилище данных (в реальном приложении - БД)
const users = new Map(); // username -> userObject
const chats = new Map(); // chatId -> chatObject
const groups = new Map(); // groupId -> groupObject
const userSessions = new Map(); // socketId -> username
const activeCalls = new Map(); // callId -> { initiator, receiver, type, status }

// ==================== API ENDPOINTS ====================

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username и пароль обязательны' });
    }

    if (users.has(username)) {
        return res.status(400).json({ error: 'Username уже занят' });
    }

    const user = {
        username,
        password, // В реальном приложении - хешировать!
        avatar: '👤',
        status: 'offline',
        createdAt: new Date(),
        friends: [],
        blockedUsers: []
    };

    users.set(username, user);
    res.json({ success: true, message: 'Аккаунт создан!' });
});

// Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!users.has(username)) {
        return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const user = users.get(username);
    if (user.password !== password) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }

    res.json({ success: true, user: { username: user.username, avatar: user.avatar } });
});

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    const allUsers = Array.from(users.values()).map(u => ({
        username: u.username,
        avatar: u.avatar,
        status: u.status
    }));
    res.json(allUsers);
});

// Создать группу
app.post('/api/groups/create', (req, res) => {
    const { name, members, createdBy } = req.body;
    const groupId = Date.now().toString();

    const group = {
        id: groupId,
        name,
        members: members || [createdBy],
        avatar: '👥',
        createdBy,
        createdAt: new Date(),
        messages: []
    };

    groups.set(groupId, group);
    res.json({ success: true, groupId, group });
});

// Получить группы пользователя
app.get('/api/groups/:username', (req, res) => {
    const { username } = req.params;
    const userGroups = Array.from(groups.values()).filter(g => g.members.includes(username));
    res.json(userGroups);
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
    console.log(`[CONNECT] ${socket.id}`);

    // Вход пользователя
    socket.on('user:login', (username) => {
        userSessions.set(socket.id, username);
        const user = users.get(username);
        if (user) {
            user.status = 'online';
        }

        io.emit('user:status', { username, status: 'online' });
        console.log(`[LOGIN] ${username}`);
    });

    // Выход пользователя
    socket.on('disconnect', () => {
        const username = userSessions.get(socket.id);
        if (username && users.has(username)) {
            users.get(username).status = 'offline';
            io.emit('user:status', { username, status: 'offline' });
        }
        userSessions.delete(socket.id);
        console.log(`[DISCONNECT] ${username}`);
    });

    // Отправка прямого сообщения
    socket.on('message:send', (data) => {
        const { from, to, content, type } = data;
        const chatId = [from, to].sort().join('-');

        if (!chats.has(chatId)) {
            chats.set(chatId, {
                id: chatId,
                participants: [from, to],
                messages: []
            });
        }

        const message = {
            id: Date.now().toString(),
            from,
            to,
            content,
            type,
            timestamp: new Date().toISOString()
        };

        chats.get(chatId).messages.push(message);

        // Отправляем обоим участникам
        io.emit('message:receive', message);
    });

    // Сообщение в группу
    socket.on('group:message:send', (data) => {
        const { groupId, from, content } = data;
        const group = groups.get(groupId);

        if (!group) return;

        const message = {
            id: Date.now().toString(),
            groupId,
            from,
            content,
            timestamp: new Date().toISOString()
        };

        group.messages.push(message);

        // Отправляем всем
        io.emit('group:message:receive', message);
    });

    // ==================== ЗВОНКИ ====================

    // Инициация звонка (аудио/видео)
    socket.on('call:initiate', (data) => {
        const { from, to, type } = data;
        const callId = Date.now().toString();

        const call = {
            id: callId,
            initiator: from,
            receiver: to,
            type,
            status: 'ringing',
            startedAt: new Date()
        };

        activeCalls.set(callId, call);

        // Отправляем уведомление получателю
        io.emit('call:incoming', {
            callId,
            from,
            type
        });

        console.log(`[CALL] ${from} -> ${to} (${type})`);
    });

    // Ответить на звонок
    socket.on('call:answer', (data) => {
        const { callId } = data;
        const call = activeCalls.get(callId);

        if (call) {
            call.status = 'active';
            io.emit('call:answered', { callId });
        }
    });

    // Завершить звонок
    socket.on('call:end', (data) => {
        const { callId } = data;
        if (activeCalls.has(callId)) {
            activeCalls.delete(callId);
            io.emit('call:ended', { callId });
        }
    });

    // Отклонить звонок
    socket.on('call:reject', (data) => {
        const { callId } = data;
        if (activeCalls.has(callId)) {
            activeCalls.delete(callId);
            io.emit('call:rejected', { callId });
        }
    });

    // Добавить пользователя в группу
    socket.on('group:add-member', (data) => {
        const { groupId, username } = data;
        const group = groups.get(groupId);

        if (group && !group.members.includes(username)) {
            group.members.push(username);
            io.emit('group:updated', { groupId, group });
        }
    });

    // Покинуть группу
    socket.on('group:leave', (data) => {
        const { groupId, username } = data;
        const group = groups.get(groupId);

        if (group) {
            group.members = group.members.filter(m => m !== username);
            io.emit('group:updated', { groupId, group });
        }
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('🚀 CloudChat Server with WebRTC');
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 WebSocket: ws://localhost:${PORT}`);
    console.log(`\n💡 Открой: http://localhost:${PORT}`);
    console.log(`⏹️  Для остановки нажми Ctrl+C\n`);
    console.log(`${'='.repeat(60)}\n`);
});
