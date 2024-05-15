const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));
app.set('trust proxy', true);

// Slovník uživatelů s IP adresou a jménem
const onlineUsers = new Map();
const talkCashBalance = new Map();
const userColors = new Map();
const BLOCK_THRESHOLD = 5;
const BLOCK_DURATION = 7 * 24 * 60 * 60 * 1000;
const connectionAttempts = new Map();
const blockedUsers = new Set();

io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    console.log(`Uživatel připojen s IP: ${clientIp}`);

    let existingUser = findUserByIp(clientIp);

    if (existingUser) {
        socket.username = existingUser.username;
        console.log(`Uživatel s IP ${clientIp} znovu připojen jako ${socket.username}`);
    } else {
        socket.username = generateUsername();
        console.log(`Nový uživatel s IP ${clientIp} připojen jako ${socket.username}`);
        saveUserToFile(clientIp, socket.username);
    }

    onlineUsers.set(socket.id, {
        ip: clientIp,
        username: socket.username,
    });

    io.to(socket.id).emit('set username', { username: socket.username });
    io.emit('update online users', onlineUsers.size);

    socket.on('set username', ({ username, color }) => {
        if (!isUsernameTaken(username)) {
            onlineUsers.set(socket.id, {
                ip: clientIp,
                username: username,
            });

            socket.username = username;
            socket.color = color || getRandomColor();
            saveUserToFile(clientIp, username);

            io.to(socket.id).emit('update color', socket.color);
            io.to(socket.id).emit('chat history', getChatHistory());
            io.emit('user joined', { username, color: socket.color });
        } else {
            socket.emit('username taken');
        }
    });

    socket.on('chat message', ({ username, color, message }) => {
        io.emit('chat message', { username, color, message });
        addMessageToHistory({ username, color, message });
    });

    socket.on('get talkCash', () => {
        io.to(socket.id).emit('update talkCash', talkCashBalance.get(socket.id) || 0);
    });

    socket.on('trade talkCash', (tradeAmount) => {
        if (tradeAmount > 0 && talkCashBalance.get(socket.id) >= tradeAmount) {
            talkCashBalance.set(socket.id, talkCashBalance.get(socket.id) - tradeAmount);
            io.to(socket.id).emit('update talkCash', talkCashBalance.get(socket.id));
        }
    });

    socket.on('work as hacker', () => {
        console.log('Pracuji jako hacker!');
        talkCashBalance.set(socket.id, (talkCashBalance.get(socket.id) || 0) + 2);
        io.to(socket.id).emit('update talkCash', talkCashBalance.get(socket.id));
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        onlineUsers.delete(socket.id);
        io.emit('update online users', onlineUsers.size);
    });

    socket.on('ban user', (targetIp) => {
        if (isAdmin(socket.id)) {
            const targetUserId = findUserIdByIp(targetIp);
            if (targetUserId) {
                blockUser(targetUserId);
                console.log(`User banned by IP: ${targetIp}`);
            } else {
                console.log(`User with IP ${targetIp} not found`);
            }
        } else {
            console.log('Unauthorized ban attempt');
        }
    });

    const userColor = getRandomColor();
    userColors.set(socket.id, userColor);
    io.to(socket.id).emit('update color', userColor);
    io.to(socket.id).emit('chat history', getChatHistory());
});

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function blockUser(socketId) {
    onlineUsers.delete(socketId);
    io.to(socketId).emit('connection blocked');
    blockedUsers.add(socketId);

    setTimeout(() => {
        blockedUsers.delete(socketId);
    }, BLOCK_DURATION);
}

function isBlocked(socketId) {
    return blockedUsers.has(socketId);
}

function findUserByIp(ip) {
    for (const [userId, userData] of onlineUsers) {
        if (userData.ip === ip) {
            return { id: userId, username: userData.username };
        }
    }
    return null;
}

function findUserIdByIp(ip) {
    for (const [userId, userData] of onlineUsers) {
        if (userData.ip === ip) {
            return userId;
        }
    }
    return null;
}

function generateUsername() {
    return `User${Math.floor(Math.random() * 10000)}`;
}

function saveUserToFile(ip, username, callback = () => {}) {
    const data = `${ip} ${username}\n`;

    fs.appendFile('user_data.txt', data, (error) => {
        if (error) {
            callback(error);
        } else {
            callback(null);
        }
    });
}

function isAdmin(socketId) {
    return true; // Toto je jen pro ukázku, změňte podle svých potřeb
}

function addMessageToHistory({ username, color, message }) {
    try {
        const history = getChatHistory();
        history.push({ username, color, message });
        fs.writeFileSync('chat_history.txt', JSON.stringify(history));
    } catch (error) {
        console.error('Error writing to chat history:', error.message);
    }
}

function getChatHistory() {
    try {
        const history = fs.readFileSync('chat_history.txt', 'utf8');
        return history.trim() === '' ? [] : JSON.parse(history);
    } catch (error) {
        console.error('Error reading chat history:', error.message);
        return [];
    }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, (error) => {
    if (error) {
        console.error('Error starting the server:', error.message);
    } else {
        console.log(`Server is running on http://localhost:${PORT}`);
    }
});
