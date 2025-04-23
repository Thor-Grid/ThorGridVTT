// c:\thorgrid-electron\src\server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const { debounce } = require('lodash');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            const allowed = !origin || origin === 'null' || origin.startsWith('http:') || origin.startsWith('https:') || origin.startsWith('file:');
            if (allowed) {
                console.log(`CORS check - Allowed Origin: ${origin}`);
                callback(null, true);
            } else {
                console.warn(`CORS check - Denied Origin: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true
    },
    serveClient: true,
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ['websocket', 'polling']
});

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main HTML file for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'multitg.html'));
});

// Log requests for debugging
app.use((req, res, next) => {
    console.log(`Request: ${req.method} ${req.url}`);
    next();
});

// Define paths and state early
const publicPath = path.join(__dirname, 'public');

// --- State File Path Logic ---
const userDataPath = process.env.USER_DATA_PATH || path.join(__dirname, '..', 'data');
const stateFileName = 'gameState.json';
const stateFilePath = path.join(userDataPath, stateFileName);
console.log(`State file path configured: ${stateFilePath}`);

async function ensureStateDirExists() {
    try {
        await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            console.error(`Error creating directory for state file (${path.dirname(stateFilePath)}):`, err);
        }
    }
}
ensureStateDirExists();
// --- End State File Path Logic ---

let gameState = {
    tokens: [],
    walls: [],
    backgroundImageUrl: '',
    gridSize: { width: 40, height: 30 },
    scale: 1,
    panX: 0,
    panY: 0,
    isGridVisible: true,
    players: {}
};
let connectedDMs = new Set();
let connectedPlayers = new Map();

// *** MOVED normalizeWalls FUNCTION HERE ***
// State normalization function
function normalizeWalls(wallsData, width, height) {
    // Ensure width and height are positive integers
    const validWidth = Math.max(1, Math.floor(width || 1));
    const validHeight = Math.max(1, Math.floor(height || 1));

    const normalized = Array(validHeight).fill(null).map(() => Array(validWidth).fill(0));

    if (wallsData && Array.isArray(wallsData)) {
        for (let y = 0; y < Math.min(validHeight, wallsData.length); y++) {
            if (wallsData[y] && Array.isArray(wallsData[y])) {
                for (let x = 0; x < Math.min(validWidth, wallsData[y].length); x++) {
                    // Ensure the value is strictly 1, otherwise default to 0
                    normalized[y][x] = wallsData[y][x] === 1 ? 1 : 0;
                }
            } else {
                // If a row is missing or not an array, it remains filled with 0s
                console.warn(`normalizeWalls: Row at index ${y} is invalid or missing. Filling with 0s.`);
            }
        }
    } else if (wallsData) {
        // If wallsData exists but isn't an array
        console.warn("normalizeWalls: wallsData is not an array. Initializing empty walls.");
    }
    // If wallsData is null/undefined, the array initialized with 0s is returned

    return normalized;
}

// Ensure initializeWalls uses the potentially updated gridSize
function initializeWalls() {
    const { width, height } = gameState.gridSize;
    // Ensure walls is always an array, even if loading fails or state is new
    gameState.walls = normalizeWalls(gameState.walls || [], width, height); // Pass potentially empty array
    console.log(`Initialized/Normalized walls for size ${width}x${height}`);
}

async function loadState() {
    try {
        await ensureStateDirExists(); // Ensure directory exists before reading
        const data = await fs.readFile(stateFilePath, 'utf8');
        const parsed = JSON.parse(data);
        gameState = {
            tokens: parsed.tokens || [],
            walls: parsed.walls || [],
            backgroundImageUrl: parsed.backgroundImageUrl || '',
            gridSize: parsed.gridSize || { width: 40, height: 30 },
            scale: parsed.scale || 1,
            panX: parsed.panX || 0,
            panY: parsed.panY || 0,
            isGridVisible: parsed.isGridVisible !== undefined ? parsed.isGridVisible : true,
            players: parsed.players || {}
        };
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        console.log(`State loaded successfully from ${stateFilePath}`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`No saved state file found at ${stateFilePath}. Initializing default state.`);
            initializeWalls(); // Initialize default walls if no state file
        } else {
            console.error(`Error loading state from ${stateFilePath}:`, err.message);
            initializeWalls();
        }
        // Initialize default/empty state parts if load failed or no file
        gameState.players = gameState.players || {};
        gameState.scale = gameState.scale || 1;
        gameState.panX = gameState.panX || 0;
        gameState.panY = gameState.panY || 0;
        gameState.isGridVisible = gameState.isGridVisible !== undefined ? gameState.isGridVisible : true;
    }
}

const saveStateDebounced = debounce(async () => {
    try {
        await ensureStateDirExists(); // Ensure directory exists before writing
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (autosave) to ${stateFilePath}`);
        io.emit('saveSuccess', 'Game state saved successfully (autosave).');
    } catch (err) {
        console.error(`Error saving state (autosave) to ${stateFilePath}:`, err.message);
        io.emit('error', 'Failed to save game state (autosave).');
    }
}, 5000); // 5 seconds debounce

async function saveStateImmediate() {
    try {
        await ensureStateDirExists();
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (manual) to ${stateFilePath}`);
        io.emit('saveSuccess', 'Game state saved successfully (manual).');
    } catch (err) {
        console.error(`Error saving state (manual) to ${stateFilePath}:`, err.message);
        io.emit('error', 'Failed to save game state (manual).');
    }
}

// Periodic save interval
setInterval(async () => {
    try {
        await ensureStateDirExists();
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (periodic) to ${stateFilePath}`);
    } catch (err) {
        console.error(`Error saving state (periodic) to ${stateFilePath}:`, err.message);
    }
}, 300000); // 5 minutes

// --- Socket.IO Handlers ---
function getUsernameFromSocket(socket) {
    return connectedPlayers.get(socket.id) || null;
}

function roleFromSocket(socket) {
    return connectedDMs.has(socket.id) ? 'dm' : 'player';
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id, 'Origin:', socket.handshake.headers.origin);

    socket.on('login', ({ role, username }) => {
        console.log(`Client ${socket.id} joined as ${role} with username ${username}`);
        if (!username || typeof username !== 'string' || username.trim() === '') {
            socket.emit('error', 'Invalid username');
            return;
        }
        if (Object.values(gameState.players).includes(username) && gameState.players[username] !== socket.id) {
            socket.emit('error', 'Username already in use');
            return;
        }
        if (role === 'dm') {
            connectedDMs.add(socket.id);
            connectedPlayers.set(socket.id, username || 'DM');
        } else {
            connectedPlayers.set(socket.id, username);
            gameState.players[username] = socket.id;
        }
        socket.emit('init', gameState);
        socket.emit('roleAssigned', { role: roleFromSocket(socket), username });
        io.emit('clients', Array.from(io.sockets.sockets.keys()));
    });

    socket.on('addToken', (tokenData) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);
        if (role === 'dm' || username) {
            const newToken = {
                ...tokenData,
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                owner: username,
                isMinion: tokenData.isMinion || false,
                parentOwner: tokenData.isMinion ? username : null
            };
            gameState.tokens.push(newToken);
            io.emit('updateTokens', gameState.tokens);
            if (role === 'dm') {
                saveStateDebounced();
            }
        }
    });

    socket.on('moveToken', ({ tokenId, x, y, rotation }) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);
        const token = gameState.tokens.find(t => t.id === tokenId);
        if (token && (role === 'dm' || token.owner === username || (token.isMinion && token.parentOwner === username))) {
            token.x = x;
            token.y = y;
            token.rotation = rotation;
            io.emit('updateTokens', gameState.tokens);
            if (role === 'dm') {
                saveStateDebounced();
            }
        }
    });

    socket.on('removeToken', (tokenId) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.tokens = gameState.tokens.filter(t => t.id !== tokenId);
            io.emit('updateTokens', gameState.tokens);
            saveStateDebounced();
        }
    });

    socket.on('updateWalls', (newWalls) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.walls = normalizeWalls(newWalls, gameState.gridSize.width, gameState.gridSize.height);
            io.emit('updateWalls', gameState.walls);
            saveStateDebounced();
        }
    });

    socket.on('updateGridVisibility', (isGridVisible) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.isGridVisible = isGridVisible;
            io.emit('updateGridVisibility', gameState.isGridVisible);
            saveStateDebounced();
        }
    });

    socket.on('updateBackground', (url) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.backgroundImageUrl = url;
            io.emit('updateBackground', url);
            saveStateDebounced();
        }
    });

    socket.on('updateGridSize', ({ width, height }) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.gridSize = { width, height };
            gameState.walls = normalizeWalls(gameState.walls, width, height);
            io.emit('updateGridSize', gameState.gridSize);
            io.emit('updateWalls', gameState.walls);
            saveStateDebounced();
        }
    });

    socket.on('saveState', () => {
        if (roleFromSocket(socket) === 'dm') {
            saveStateImmediate();
        }
    });

    socket.on('importState', async (newState) => {
        if (roleFromSocket(socket) === 'dm') {
            try {
                gameState = {
                    tokens: newState.tokens || [],
                    walls: normalizeWalls(newState.walls || [], newState.gridSize?.width || gameState.gridSize.width, newState.gridSize?.height || gameState.gridSize.height),
                    backgroundImageUrl: newState.backgroundImageUrl || '',
                    gridSize: newState.gridSize || { width: 40, height: 30 },
                    scale: gameState.scale,
                    panX: gameState.panX,
                    panY: gameState.panY,
                    isGridVisible: gameState.isGridVisible,
                    players: gameState.players || {}
                };
                await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
                io.emit('importState', gameState);
                socket.emit('saveSuccess', 'Game state imported and saved successfully.');
                console.log('Game state imported successfully');
            } catch (err) {
                console.error('Error importing state:', err);
                socket.emit('error', 'Failed to import game state.');
            }
        }
    });

    socket.on('updateTokenStats', ({ tokenId, hp, initiative, ac, maxHP }) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);
        const token = gameState.tokens.find(t => t.id === tokenId);
        if (token && (role === 'dm' || token.owner === username || (token.isMinion && token.parentOwner === username))) {
            token.hp = hp;
            token.initiative = initiative;
            token.ac = ac;
            if (maxHP !== undefined) token.maxHP = maxHP;
            io.emit('updateTokens', gameState.tokens);
            if (role === 'dm') {
                saveStateDebounced();
            }
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        connectedDMs.delete(socket.id);
        const username = connectedPlayers.get(socket.id);
        if (username) {
            delete gameState.players[username];
            connectedPlayers.delete(socket.id);
            console.log(`Removed username ${username} from players`);
        }
        io.emit('clients', Array.from(io.sockets.sockets.keys()));
    });
});

// Export for Electron
module.exports = { server, io, loadState, saveStateImmediate };