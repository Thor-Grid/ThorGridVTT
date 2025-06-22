// c:\thorgrid-electron\src\server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const { debounce } = require('lodash');
const config = require('./config');
const { DiceRoll } = require('@dice-roller/rpg-dice-roller');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            // Allow requests from same origin, file:// (for Electron), and explicit http/https
            const allowed = !origin || origin === 'null' || origin.startsWith('http:') || origin.startsWith('https:') || origin.startsWith('file:');
            if (allowed) {
                // console.log(`CORS check - Allowed Origin: ${origin}`); // Uncomment for verbose logging
                callback(null, true);
            } else {
                console.warn(`CORS check - Denied Origin: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true
    },
    serveClient: true, // Serve the socket.io client library
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8
});

				// --- Collision Detection Helper ---
                // Checks if a token at a proposed position (newX, newY) collides with walls or goes out of bounds
                function isCollision(newX, newY, token, walls, gridWidth, gridHeight) {
                    const tokenSize = token.size || 1; // Default to size 1 if undefined

                    // Check if any cell the token would occupy is out of bounds or a wall
                    for (let dy = 0; dy < tokenSize; dy++) {
                        for (let dx = 0; dx < tokenSize; dx++) {
                            const checkX = newX + dx;
                            const checkY = newY + dy;

                            // Check out of bounds
                            if (checkX < 0 || checkX >= gridWidth || checkY < 0 || checkY >= gridHeight) {
                                // return true; // We already clamp to bounds before calling this in client move,
                                              // but checking here is good for server-side validation.
                                              // Let's return false for out-of-bounds here, as clamping handles that.
                                              // Collision specifically means hitting a wall *within* bounds.
                                continue; // Skip this cell check if out of bounds, rely on clamping to prevent OOB moves
                            }

                            // Check for wall collision at this cell
                            // Ensure walls[checkY] exists before accessing walls[checkY][checkX]
                            if (walls[checkY] && walls[checkY][checkX] === 1) {
                                return true; // Collision detected!
                            }
                        }
                    }

                    return false; // No collision detected in the proposed new position
                }

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Serve the main HTML file for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'multitg.html'));
});

// Log requests for debugging (optional)
// app.use((req, res, next) => {
//     console.log(`Request: ${req.method} ${req.url}`);
//     next();
// });

// Define paths and state early
// const publicPath = path.join(__dirname, 'public'); // This variable isn't used, can be removed if preferred

// --- State File Path Logic ---
// Use USER_DATA_PATH provided by Electron main process, fallback to local 'data' directory
const userDataPath = process.env.USER_DATA_PATH || path.join(__dirname, '..', 'data');
const stateFileName = 'gameState.json';
const stateFilePath = path.join(userDataPath, stateFileName);
//console.log(`State file path configured: ${stateFilePath}`);

async function ensureStateDirExists() {
    try {
        await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') {
            console.error(`Error creating directory for state file (${path.dirname(stateFilePath)}):`, err);
            // In a production app, you might want to handle this more severely
        }
    }
}
// Call immediately to ensure dir exists on startup
ensureStateDirExists();
// --- End State File Path Logic ---

// Game state - This object is saved and loaded
let gameState = {
    tokens: [],
    walls: [],
    backgroundImageUrl: '',
    gridSize: { width: 40, height: 30 },
    viewState: { scale: 1, panX: 0, panY: 0 }, // Store view state here
    isGridVisible: true, // Controls drawing grid lines
	isMapFullyVisible: false, // NEW: State for DM's "All Visible Map" toggle
    // Removed 'players' from here - active players are managed in memory
};

// In-memory tracking of connected clients
let connectedDMs = new Set(); // Set of socket IDs for DMs
let connectedPlayers = new Map(); // Map of socket ID -> username

// State normalization function (moved outside load/save for reuse)
function normalizeWalls(wallsData, width, height) {
    // Ensure width and height are positive integers
    const validWidth = Math.max(1, Math.floor(width || 1));
    const validHeight = Math.max(1, Math.floor(height || 1));

    // Create a new 2D array filled with 0s for the target size
    const normalized = Array(validHeight).fill(null).map(() => Array(validWidth).fill(0));

    if (wallsData && Array.isArray(wallsData)) {
        // Copy existing wall data up to the bounds of the new size
        for (let y = 0; y < Math.min(validHeight, wallsData.length); y++) {
            if (wallsData[y] && Array.isArray(wallsData[y])) {
                for (let x = 0; x < Math.min(validWidth, wallsData[y].length); x++) {
                    // Ensure the value is strictly 1, otherwise default to 0
                    normalized[y][x] = wallsData[y][x] === 1 ? 1 : 0;
                }
            }
            // If a row is invalid or missing, the corresponding row in 'normalized' remains 0s
        }
    } else if (wallsData) {
        // If wallsData exists but isn't an array
        console.warn("normalizeWalls: wallsData is not an array. Initializing empty walls.");
    }
    // If wallsData is null/undefined, the array initialized with 0s is returned

    return normalized;
}

// Initialize walls on startup if needed (will be overwritten by loadState if file exists)
function initializeWalls() {
    const { width, height } = gameState.gridSize;
     // Only re-initialize if gameState.walls is null or not an array
    if (!Array.isArray(gameState.walls)) {
         gameState.walls = normalizeWalls([], width, height);
    } else {
         // Even if it's an array, normalize it to the current grid size
         gameState.walls = normalizeWalls(gameState.walls, width, height);
    }
    console.log(`Walls normalized for size ${width}x${height}`);
}


async function loadState() {
    try {
        await ensureStateDirExists(); // Ensure directory exists before reading
        const data = await fs.readFile(stateFilePath, 'utf8');
        const parsed = JSON.parse(data);

        // Load specific properties, providing defaults if missing
        gameState.tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];
        // Normalize walls based on potentially loaded gridSize
        gameState.gridSize = parsed.gridSize || { width: 40, height: 30 };
        gameState.walls = normalizeWalls(parsed.walls, gameState.gridSize.width, gameState.gridSize.height);
        gameState.backgroundImageUrl = parsed.backgroundImageUrl || '';
        gameState.isGridVisible = parsed.isGridVisible !== undefined ? parsed.isGridVisible : true;
		gameState.isMapFullyVisible = parsed.isMapFullyVisible !== undefined ? parsed.isMapFullyVisible : false; // NEW: Load state for toggle

        // Load view state if present, otherwise use defaults
        gameState.viewState = parsed.viewState || { scale: 1, panX: 0, panY: 0 };


        // Ensure tokens have necessary default properties if missing from loaded state (for backwards compatibility)
        gameState.tokens = gameState.tokens.map(token => ({
            ...token,
             // Add defaults for new properties if loading older state files
             maxHP: token.maxHP !== undefined ? token.maxHP : 0,
             hp: token.hp !== undefined ? token.hp : 0,
             initiative: token.initiative !== undefined ? token.initiative : 0,
             ac: token.ac !== undefined ? token.ac : 0,
             rotation: token.rotation !== undefined ? token.rotation : 0,
             sightRadius: token.sightRadius !== undefined ? token.sightRadius : 0, // Ensure sightRadius exists
             isLightSource: Boolean(token.isLightSource), // Ensure isLightSource exists and is boolean
             brightRange: token.brightRange !== undefined ? token.brightRange : 0, // Ensure brightRange exists
             dimRange: token.dimRange !== undefined ? token.dimRange : 0,         // Ensure dimRange exists
             isMinion: token.isMinion !== undefined ? token.isMinion : false,
             owner: token.owner || null,
             parentOwner: token.parentOwner || null,
             size: Number.isFinite(token.size) && token.size > 0 ? token.size : 1, // Ensure size is valid number
        }));


        console.log(`State loaded successfully from ${stateFilePath}`);
        console.log(`Loaded gridSize: ${gameState.gridSize.width}x${gameState.gridSize.height}`);
        console.log(`Loaded ${gameState.tokens.length} tokens.`);
		
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`No saved state file found at ${stateFilePath}. Initializing default state.`);
        } else {
            console.error(`Error loading state from ${stateFilePath}:`, err.message);
        }
        // Initialize default state parts if load failed or no file
        gameState = {
            tokens: [],
            walls: normalizeWalls([], gameState.gridSize.width, gameState.gridSize.height), // Ensure walls are initialized for default/loaded size
            backgroundImageUrl: '',
            gridSize: gameState.gridSize || { width: 40, height: 30 }, // Keep size if it was loaded
            viewState: { scale: 1, panX: 0, panY: 0 },
            isGridVisible: true,
			isMapFullyVisible: false, // NEW: Default state for toggle
        };
         console.log("Initialized default state.");
    }
    // Ensure walls are normalized again just in case 
     gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
}

// Save state function with debouncing
const saveStateDebounced = debounce(async () => {
    try {
        await ensureStateDirExists(); // Ensure directory exists before writing
        // Ensure walls are normalized to current size before saving
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (autosave) to ${stateFilePath}`);
        // io.emit('saveSuccess', 'Game state saved successfully (autosave).'); // Avoid spamming notifications for autosave
    } catch (err) {
        console.error(`Error saving state (autosave) to ${stateFilePath}:`, err.message);
        // io.emit('error', 'Failed to save game state (autosave).'); // Avoid spamming errors
    }
}, 5000); // 5 seconds debounce

// Save state function for manual saves
async function saveStateImmediate() {
    try {
        await ensureStateDirExists();
        // Ensure walls are normalized to current size before saving
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (manual) to ${stateFilePath}`);
        io.emit('saveSuccess', 'Game state saved successfully (manual).');
    } catch (err) {
        console.error(`Error saving state (manual) to ${stateFilePath}:`, err.message);
        io.emit('error', 'Failed to save game state (manual).');
    }
}

// Periodic save interval (in addition to debounced saves)
// This acts as a safety net for state changes that might not trigger debounced save (e.g., app close)
setInterval(async () => {
    try {
        await ensureStateDirExists();
        gameState.walls = normalizeWalls(gameState.walls, gameState.gridSize.width, gameState.gridSize.height);
        await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));
        console.log(`Game state saved successfully (periodic) to ${stateFilePath}`);
    } catch (err) {
        console.error(`Error saving state (periodic) to ${stateFilePath}:`, err.message);
    }
}, 300000); // 5 minutes (300 * 1000 ms)

// --- Helper Functions for Socket Handlers ---
function getUsernameFromSocket(socket) {
    return connectedPlayers.get(socket.id) || 'Unknown User';
}

function roleFromSocket(socket) {
    return connectedDMs.has(socket.id) ? 'dm' : 'player';
}

// --- Socket.IO Handlers ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id, 'Origin:', socket.handshake.headers.origin);

    socket.on('login', ({ role, username }) => {
        const trimmedUsername = username ? username.trim() : '';
        console.log(`Client ${socket.id} attempting login as ${role} with username "${trimmedUsername}"`);

        if (!trimmedUsername || typeof trimmedUsername !== 'string') {
            socket.emit('error', 'Invalid username');
            console.warn(`Client ${socket.id} login failed: Invalid username.`);
            return;
        }

        // Check if the desired username is already in use by a *different* active socket ID
        const usernameIsTakenByOther = Array.from(connectedPlayers.entries())
            .some(([id, name]) => name === trimmedUsername && id !== socket.id);

        if (usernameIsTakenByOther) {
            socket.emit('error', 'Username already in use');
            console.warn(`Client ${socket.id} login failed: Username "${trimmedUsername}" already in use.`);
            return;
        }

        // If we reach here, the username is either new or belongs to this socket (e.g., reconnect)

        // If the username was previously used by *this* socket ID, clean up the old entry first
        // (Should be handled by disconnect, but belt+suspenders)
        // Find if this socket ID had a different username before
         if (connectedPlayers.has(socket.id) && connectedPlayers.get(socket.id) !== trimmedUsername) {
              console.log(`Client ${socket.id} changing username from "${connectedPlayers.get(socket.id)}" to "${trimmedUsername}"`);
         }


        // Assign role
        if (role === 'dm') {
            connectedDMs.add(socket.id);
        } else {
             // Ensure they are not in the DM set if they login as player
             connectedDMs.delete(socket.id);
        }

        // Store the username for this socket, overwriting any previous one
        connectedPlayers.set(socket.id, trimmedUsername);
        console.log(`Client ${socket.id} logged in successfully as ${role} with username "${trimmedUsername}"`);

        // Send initial state
        // We send the entire gameState object (excluding in-memory player list)
        const stateToSend = { ...gameState };
        // We don't need to send the view state back on init, client manages its own view.
        // But we included it in the save format, so it will be part of fullStateUpdate/import.
        // Delete it from the *initial* send if you want to force client view reset on fresh connect.
        // For now, let's keep it consistent with the save format and send it.


        socket.emit('init', stateToSend);

        // Confirm role assignment to client
        socket.emit('roleAssigned', { role: roleFromSocket(socket), username: trimmedUsername });

        // Broadcast list of *usernames* to all clients (including the sender)
        io.emit('clients', Array.from(connectedPlayers.values()));

    });

    socket.on('addToken', (tokenData) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);

        // Only allow DM or a logged-in player to add a token
        if (role === 'dm' || username) {
            const newToken = {
                ...tokenData, // Includes name, size, rotation, image/color, isMinion
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate unique ID on server
                owner: username, // Set owner based on logged-in user
                parentOwner: tokenData.isMinion ? username : null, // Set parent owner if it's a minion

                 // Ensure default numeric/boolean values if not provided by client or are invalid
                x: Number.isFinite(tokenData.x) ? Number(tokenData.x) : Math.floor(gameState.gridSize.width / 2), // Default position
                y: Number.isFinite(tokenData.y) ? Number(tokenData.y) : Math.floor(gameState.gridSize.height / 2),
                size: Number.isFinite(tokenData.size) && tokenData.size > 0 ? Number(tokenData.size) : 1,
                rotation: Number.isFinite(tokenData.rotation) ? Number(tokenData.rotation) % 360 : 0,
                maxHP: role === 'dm' && Number.isFinite(tokenData.maxHP) ? Number(tokenData.maxHP) : 0, // Only DM sets maxHP
                hp: role === 'dm' && Number.isFinite(tokenData.hp) ? Number(tokenData.hp) : 0,         // Only DM sets hp
                initiative: Number.isFinite(tokenData.initiative) ? Number(tokenData.initiative) : 0,
                ac: Number.isFinite(tokenData.ac) ? Number(tokenData.ac) : 0,
                sightRadius: Number.isFinite(tokenData.sightRadius) ? Number(tokenData.sightRadius) : 0, // <--- Handle sightRadius from client
                isLightSource: Boolean(tokenData.isLightSource), // <--- Handle isLightSource
                brightRange: Number.isFinite(tokenData.brightRange) ? Number(tokenData.brightRange) : 0, // <--- Handle brightRange
                dimRange: Number.isFinite(tokenData.dimRange) ? Number(tokenData.dimRange) : 0,     // <--- Handle dimRange
                name: tokenData.name && tokenData.name.trim() !== '' ? tokenData.name.trim() : (username ? `${username}'s Token` : 'Unnamed Token'), // Default name


                 // Image/color handling - client sends imageUrl or backgroundColor
                 imageUrl: tokenData.imageUrl || null,
                 imageFilename: tokenData.imageFilename || null,
                 backgroundColor: tokenData.backgroundColor || null
            };

            // Server-side validation for position bounds (optional but good)
            const maxX = gameState.gridSize.width - newToken.size;
            const maxY = gameState.gridSize.height - newToken.size;
            newToken.x = Math.max(0, Math.min(newToken.x, maxX));
            newToken.y = Math.max(0, Math.min(newToken.y, maxY));


            gameState.tokens.push(newToken);
            console.log(`Token added by "${username}" (${role}): "${newToken.name}" (ID: ${newToken.id})`);
            io.emit('updateTokens', gameState.tokens); // Broadcast the updated list of tokens
            saveStateDebounced(); // Auto-save state after change
        } else {
             socket.emit('error', 'Authentication required or role mismatch to add tokens.');
             console.warn(`Client ${socket.id} attempted to add token without login or proper role.`);
        }
    });

    // --- Modified moveToken handler ---
    // Now receives rotation from client move events
    socket.on('moveToken', ({ tokenId, x, y, rotation }) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);
        const token = gameState.tokens.find(t => t.id === tokenId);

        // Check if token exists AND if user is DM OR owns/parents the token
        if (token && (role === 'dm' || token.owner === username || (token.isMinion && token.parentOwner === username))) {
            // Ensure position and rotation are valid numbers
            const requestedX = Number.isFinite(x) ? Number(x) : token.x; // Client's requested X
            const requestedY = Number.isFinite(y) ? Number(y) : token.y; // Client's requested Y
            const newRotation = Number.isFinite(rotation) ? Number(rotation) % 360 : token.rotation;

            // --- SERVER-SIDE SINGLE-STEP & COLLISION CHECK ---
            // Calculate the target cell based on one step from the token's *current* server position
            // towards the client's *requested* position.
            const currentX = token.x;
            const currentY = token.y;

            // Determine the direction of the client's request relative to the server's current position
            // Use Math.sign to get -1, 0, or 1 indicating the step direction
            const stepX = Math.sign(requestedX - currentX);
            const stepY = Math.sign(requestedY - currentY);

            // Calculate the proposed server-side target cell (one step from current)
            let serverTargetX = currentX + stepX;
            let serverTargetY = currentY + stepY;

            // Server-side clamping of the single step to grid bounds
            const tokenSize = token.size || 1;
            const maxX = gameState.gridSize.width - tokenSize;
            const maxY = gameState.gridSize.height - tokenSize;
            serverTargetX = Math.max(0, Math.min(serverTargetX, maxX));
            serverTargetY = Math.max(0, Math.min(serverTargetY, maxY));

            // Only perform collision check if the target cell is different from the current cell
            if (token.x !== serverTargetX || token.y !== serverTargetY) {
                // Check for collision at the proposed single step target cell
                if (isCollision(serverTargetX, serverTargetY, token, gameState.walls, gameState.gridSize.width, gameState.gridSize.height)) {
                    // If there IS a collision, log it and DO NOT update state or broadcast
                    console.log(`Server: Collision detected for token ${tokenId} ("${token.name}") at [${serverTargetX}, ${serverTargetY}]. Move blocked.`);
                    // Optional: Notify the specific client if their move was blocked by server validation
                    // This might be needed if client-side collision was somehow bypassed or they are cheating.
                    // socket.emit('moveBlocked', { tokenId: tokenId, x: token.x, y: token.y }); // Tell client to revert to previous server-confirmed position
                    return; // Stop processing this move request
                }
            }
            // If we reach here, the single step move is valid (or client requested no change)

            // Update token position on the server state to the valid single step target
            // Only update if position or rotation actually changed from the *original* server state
            // Check against the original token.x/y just to avoid unnecessary updates if the single-step didn't move it.
            if (token.x !== serverTargetX || token.y !== serverTargetY || token.rotation !== newRotation) {
                token.x = serverTargetX; // Update to the validated single step
                token.y = serverTargetY; // Update to the validated single step
                token.rotation = newRotation; // Update rotation (client sends this regardless of move)
                // console.log(`Server: Token moved: "${token.name}" (ID: ${tokenId}) to [${token.x}, ${token.y}], Rot: ${token.rotation}`); // COMMENTED OUT
                io.emit('updateTokens', gameState.tokens); // Broadcast the updated list of tokens to ALL clients
                saveStateDebounced(); // Auto-save state after change
            }

        } else {
             // Optional: Log unauthorized move attempts
             // console.warn(`Server: Client ${socket.id} attempted unauthorized move of token ${tokenId}.`);
        }
    });

    socket.on('removeToken', (tokenId) => {
        if (roleFromSocket(socket) === 'dm') {
            const initialTokenCount = gameState.tokens.length;
            gameState.tokens = gameState.tokens.filter(t => t.id !== tokenId);
            if (gameState.tokens.length < initialTokenCount) {
                console.log(`Token removed: ${tokenId} by DM "${getUsernameFromSocket(socket)}"`);
                io.emit('updateTokens', gameState.tokens); // Broadcast the updated list
                saveStateDebounced(); // Auto-save state after change
            } else {
                 console.warn(`DM "${getUsernameFromSocket(socket)}" attempted to remove non-existent token ${tokenId}.`);
            }
        } else {
             socket.emit('error', 'Only the DM can remove tokens.');
             console.warn(`Client ${socket.id} attempted unauthorized token removal.`);
        }
    });

    socket.on('updateWalls', (newWalls) => {
        if (roleFromSocket(socket) === 'dm') {
            // Ensure newWalls is an array before processing
            if (Array.isArray(newWalls)) {
                gameState.walls = normalizeWalls(newWalls, gameState.gridSize.width, gameState.gridSize.height);
                console.log(`Walls updated by DM "${getUsernameFromSocket(socket)}"`);
                io.emit('updateWalls', gameState.walls); // Broadcast the updated walls array
                saveStateDebounced(); // Auto-save state after change
            } else {
                 console.warn(`DM "${getUsernameFromSocket(socket)}" sent invalid wall data.`);
            }
        } else {
             socket.emit('error', 'Only the DM can update walls.');
             console.warn(`Client ${socket.id} attempted unauthorized wall update.`);
        }
    });

    socket.on('updateGridVisibility', (isGridVisible) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.isGridVisible = Boolean(isGridVisible); // Ensure boolean
            console.log(`Grid visibility set to ${gameState.isGridVisible} by DM "${getUsernameFromSocket(socket)}"`);
            io.emit('updateGridVisibility', gameState.isGridVisible); // Broadcast the visibility state
            saveStateDebounced(); // Auto-save state after change
        } else {
             socket.emit('error', 'Only the DM can toggle grid visibility.');
             console.warn(`Client ${socket.id} attempted unauthorized grid visibility toggle.`);
        }
    });

    socket.on('updateBackground', (url) => {
        if (roleFromSocket(socket) === 'dm') {
            gameState.backgroundImageUrl = url || ''; // Ensure it's a string or empty
            console.log(`Background updated by DM "${getUsernameFromSocket(socket)}"`);
            io.emit('updateBackground', gameState.backgroundImageUrl); // Broadcast the background URL
            saveStateDebounced(); // Auto-save state after change
        } else {
             socket.emit('error', 'Only the DM can change the background.');
             console.warn(`Client ${socket.id} attempted unauthorized background update.`);
        }
    });

    socket.on('updateGridSize', ({ width, height }) => {
		if (roleFromSocket(socket) === 'dm') {
			const newWidth = Math.max(1, Math.floor(Number(width)));
			const newHeight = Math.max(1, Math.floor(Number(height)));

			// --- Added Min/Max Validation for customGrid ---
			const minSize = 5;  // Consistent with client
			const maxSize = 500; // Consistent with client
			if (newWidth < minSize || newWidth > maxSize || newHeight < minSize || newHeight > maxSize) {
				socket.emit('error', `Invalid grid size. Dimensions must be between ${minSize} and ${maxSize}.`);
				console.warn(`DM "${getUsernameFromSocket(socket)}" attempted invalid grid size: ${newWidth}x${newHeight}`);
				return; // Stop processing
			}
			// --- End Validation ---


			// Only update if size is actually different
			if (gameState.gridSize.width !== newWidth || gameState.gridSize.height !== newHeight) {
				gameState.gridSize = { width: newWidth, height: newHeight };
				gameState.walls = normalizeWalls(gameState.walls, newWidth, newHeight);
				console.log(`Grid size updated to ${newWidth}x${newHeight} by DM "${getUsernameFromSocket(socket)}"`);
				io.emit('updateGridSize', gameState.gridSize); // Broadcast the new size
				io.emit('updateWalls', gameState.walls); // Broadcast normalized walls
				saveStateDebounced();
			}
		} else {
			 socket.emit('error', 'Only the DM can change the grid size.');
			 console.warn(`Client ${socket.id} attempted unauthorized grid size change.`);
		}
	});

    socket.on('saveState', () => {
        if (roleFromSocket(socket) === 'dm') {
            saveStateImmediate(); // Manual save
        } else {
             socket.emit('error', 'Only the DM can manually save the state.');
        }
    });

    // --- Handles state import and broadcasts the new state ---
    // In server.js
	socket.on('importState', async (newState) => {
		if (roleFromSocket(socket) === 'dm') {
			try {
				 // Basic validation of the imported state structure
				if (!newState || !Array.isArray(newState.tokens) || !Array.isArray(newState.walls) || !newState.gridSize) {
					 throw new Error('Invalid imported state structure');
				}

				// Apply the imported state to the server's gameState - assign raw parts first
				// Ensure default values/types for top-level state properties
				gameState.gridSize = newState.gridSize || { width: 40, height: 30 }; // Ensure gridSize is set early for wall normalization
				gameState.backgroundImageUrl = newState.backgroundImageUrl || '';
				gameState.isGridVisible = newState.isGridVisible !== undefined ? Boolean(newState.isGridVisible) : true;
				gameState.isMapFullyVisible = newState.isMapFullyVisible !== undefined ? Boolean(newState.isMapFullyVisible) : false;
				gameState.viewState = newState.viewState || { scale: 1, panX: 0, panY: 0 }; // Ensure viewState


				// Normalize imported walls based on the imported/default grid size
				gameState.walls = normalizeWalls(newState.walls, gameState.gridSize.width, gameState.gridSize.height);

				// --- ADDED: Normalize and ensure imported tokens have all properties on the SERVER ---
				// This prevents crashes if the imported JSON is missing expected token properties
				gameState.tokens = (newState.tokens || []).map(token => ({ // Ensure it's an array
					...token, // Keep existing properties from the imported token
					// Ensure numeric/boolean types and provide defaults for potentially missing properties
					// Use gameState.gridSize after it's been set/defaulted above for position clamping
					x: Number.isFinite(token.x) ? Number(token.x) : Math.floor((gameState.gridSize.width || 40) / 2), // Default position
					y: Number.isFinite(token.y) ? Number(token.y) : Math.floor((gameState.gridSize.height || 30) / 2),
					size: Number.isFinite(token.size) && token.size > 0 ? Number(token.size) : 1, // Ensure size is valid number
					rotation: Number.isFinite(token.rotation) ? Number(token.rotation) : 0, // Ensure numeric
					maxHP: token.maxHP !== undefined ? Number(token.maxHP) : 0, // Ensure numeric
					hp: token.hp !== undefined ? Number(token.hp) : 0,           // Ensure numeric
					initiative: token.initiative !== undefined ? Number(token.initiative) : 0, // Ensure numeric
					ac: token.ac !== undefined ? Number(token.ac) : 0,             // Ensure numeric
					sightRadius: Number.isFinite(token.sightRadius) ? Number(token.sightRadius) : 0, // Ensure numeric exists
					isLightSource: Boolean(token.isLightSource), // Ensure boolean exists
					brightRange: Number.isFinite(token.brightRange) ? Number(token.brightRange) : 0, // Ensure numeric exists
					dimRange: Number.isFinite(token.dimRange) ? Number(token.dimRange) : 0,         // Ensure numeric exists
					isMinion: token.isMinion !== undefined ? Boolean(token.isMinion) : false, // Ensure boolean
					owner: token.owner || null, // Ensure owner is string or null
					parentOwner: token.parentOwner || null, // Ensure parentOwner is string or null
					// Ensure image/color properties exist
					imageUrl: token.imageUrl || null,
					imageFilename: token.imageFilename || null,
					backgroundColor: token.backgroundColor || null,
					// Add a unique ID if it's missing from the imported token (prevents issues if importing older formats or manually crafted JSON)
					id: token.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${token.name || 'token'}`
				}));
				// --- END ADDED ---


				// Save the imported state immediately to the file
				// gameState now contains the normalized tokens array
				await fs.writeFile(stateFilePath, JSON.stringify(gameState, null, 2));

				// Broadcast the *entire* new state to all clients
				// This will trigger the 'fullStateUpdate' handler on clients, which also normalizes client-side
				io.emit('fullStateUpdate', gameState);

				// Send success notification back to the importing DM
				socket.emit('saveSuccess', 'Game state imported and saved successfully.');
				console.log(`Game state imported by DM "${getUsernameFromSocket(socket)}"`);

			} catch (err) {
				console.error('Error importing state:', err);
				socket.emit('error', `Failed to import game state: ${err.message}`);
			}
		} else {
			 socket.emit('error', 'Only the DM can import the state.');
		}
	});
	
	socket.on('toggleMapVisibility', (newState) => {
        // Only allow the DM to change this state
        if (roleFromSocket(socket) === 'dm') {
             const isNowVisible = Boolean(newState); // Ensure the received state is boolean
             // Only update the state if it's actually changing to avoid unnecessary broadcasts/saves
             if (gameState.isMapFullyVisible !== isNowVisible) {
                 gameState.isMapFullyVisible = isNowVisible;
                 console.log(`Map visibility toggle set to ${gameState.isMapFullyVisible} by DM "${getUsernameFromSocket(socket)}"`);
                 // Broadcast the new state to ALL clients (DMs and Players)
                 io.emit('mapVisibilityToggled', gameState.isMapFullyVisible);
                 saveStateDebounced(); // Auto-save state after change
             }
        } else {
            // Optionally send an error back if a non-DM tries to toggle
            socket.emit('error', 'Only the DM can toggle global map visibility.');
            console.warn(`Client ${socket.id} attempted unauthorized map visibility toggle.`);
        }
    });

    // --- Modified updateTokenStats handler ---
    // Now receives rotation, sightRadius, isLightSource, brightRange, dimRange from the context menu save
    socket.on('updateTokenStats', ({ tokenId, hp, initiative, ac, maxHP, rotation, sightRadius, isLightSource, brightRange, dimRange }) => {
        const role = roleFromSocket(socket);
        const username = getUsernameFromSocket(socket);
        const token = gameState.tokens.find(t => t.id === tokenId);

        // Check if token exists AND if user is DM OR owns/parents the token
        if (token && (role === 'dm' || token.owner === username || (token.isMinion && token.parentOwner === username))) {
            let changed = false;

            // Update stats if provided and are valid numbers (DM or Owner depending on context menu fields)
            // Client context menu restricts which fields are sent by player owners, server trusts this for simplicity
            if (hp !== undefined) { const numHp = Number(hp); if (Number.isFinite(numHp) && token.hp !== numHp) { token.hp = numHp; changed = true; }}
            if (initiative !== undefined) { const numInit = Number(initiative); if (Number.isFinite(numInit) && token.initiative !== numInit) { token.initiative = numInit; changed = true; }}
            if (ac !== undefined) { const numAc = Number(ac); if (Number.isFinite(numAc) && token.ac !== numAc) { token.ac = numAc; changed = true; }}
            // Max HP, Sight Radius, Light Source properties are DM-only fields in the context menu
            if (role === 'dm') {
                 if (maxHP !== undefined) { const numMaxHp = Number(maxHP); if (Number.isFinite(numMaxHp) && numMaxHp >= 0 && token.maxHP !== numMaxHp) { token.maxHP = numMaxHp; changed = true; }}
                 if (sightRadius !== undefined) { const numSight = Number(sightRadius); if (Number.isFinite(numSight) && numSight >= 0 && token.sightRadius !== numSight) { token.sightRadius = numSight; changed = true; }}
                 if (isLightSource !== undefined) { const boolLight = Boolean(isLightSource); if (token.isLightSource !== boolLight) { token.isLightSource = boolLight; changed = true; }}
                 if (brightRange !== undefined) { const numBright = Number(brightRange); if (Number.isFinite(numBright) && numBright >= 0 && token.brightRange !== numBright) { token.brightRange = numBright; changed = true; }}
                 if (dimRange !== undefined) { const numDim = Number(dimRange); if (Number.isFinite(numDim) && numDim >= 0 && token.dimRange !== numDim) { token.dimRange = numDim; changed = true; }}
                 // Ensure dim is always >= bright
                 if (token.dimRange < token.brightRange) {
                     token.dimRange = token.brightRange;
                     changed = true; // This change also needs to be reflected
                 }
            }

            // Rotation can be updated by DM or player owner via context menu
            // The client sends rotation with both moveToken and updateTokenStats
            // Ensure we handle rotation updates here too if sent
             if (rotation !== undefined) {
                 const numRotation = Number(rotation) % 360;
                 if (Number.isFinite(numRotation) && token.rotation !== numRotation) { token.rotation = numRotation; changed = true; }
             }


            if (changed) {
                 console.log(`Token stats updated: "${token.name}" (ID: ${tokenId}) by "${username}" (${role})`);
                 io.emit('updateTokens', gameState.tokens); // Broadcast the updated list
                 if (role === 'dm') { // Only autosave if DM made changes
                     saveStateDebounced();
                 }
            }
        } else {
             // Optional: Log unauthorized stat update attempts
             // console.warn(`Client ${socket.id} attempted unauthorized stat update of token ${tokenId}.`);
        }
    });
	
	// +++++++++++++ NEW DICE ROLLING HANDLER +++++++++++++
    socket.on('rollDice', (data) => {
		const username = getUsernameFromSocket(socket);
		const userRole = roleFromSocket(socket); // Get the user's role
		const diceString = data.diceString ? data.diceString.trim() : '';
		const isRollIntendedToBeHidden = data.isHidden && userRole === 'dm'; // Check if DM *intends* to hide

		if (!diceString) {
			socket.emit('error', 'Dice string cannot be empty.');
			return;
		}

		console.log(`${username} is rolling: ${diceString}` + (isRollIntendedToBeHidden ? " (intended hidden)" : ""));
		const timestamp = new Date().toISOString(); // Define timestamp once

		try { // <--- TRY BLOCK STARTS HERE
			const roll = new DiceRoll(diceString);

			// This is the complete result, always calculated
			const completeRollData = {
				roller: username,
				input: diceString,
				output: roll.output,
				total: roll.total,
				timestamp: timestamp
			};

			if (isRollIntendedToBeHidden) {
				// Send full result only to the DM who rolled
				// Add a flag so the DM's client knows this was *their* hidden roll
				socket.emit('diceResult', { ...completeRollData, isHiddenByDM: true, forPlayerView: false });

				// Send a generic message to other clients
				const hiddenMessageToPlayers = {
					roller: username,
					input: diceString, // Optional: show players what kind of dice
					output: "DM rolled privately: ???",
					total: "???",
					isHiddenByDM: true, // This flags it as a hidden roll outcome for players
					forPlayerView: true, // This helps client differentiate
					timestamp: timestamp
				};
				// Send to everyone EXCEPT the sender (DM)
				socket.broadcast.emit('diceResult', hiddenMessageToPlayers);
			
			} else {
				// Public roll, send full result to everyone
				// (including the roller, who might be a player or a DM rolling publicly)
				io.emit('diceResult', { ...completeRollData, isHiddenByDM: false, forPlayerView: false });
			}

		} catch (error) { // <--- CATCH BLOCK MATCHES THE TRY
			console.error(`Error rolling dice "${diceString}" for ${username}:`, error.message);
			socket.emit('error', `Invalid dice notation: ${error.message}`);
		}
	});
	
	socket.on('clearBoard', () => {
        if (roleFromSocket(socket) === 'dm') {
            console.log(`Board clear requested by DM: ${getUsernameFromSocket(socket)}`);

            gameState.tokens = [];
            io.emit('updateTokens', gameState.tokens);

            gameState.walls = normalizeWalls([], gameState.gridSize.width, gameState.gridSize.height);
            io.emit('updateWalls', gameState.walls);

            gameState.backgroundImageUrl = '';
            io.emit('updateBackground', gameState.backgroundImageUrl);

            gameState.isGridVisible = true;
            io.emit('updateGridVisibility', gameState.isGridVisible);
            
            gameState.isMapFullyVisible = false;
            io.emit('mapVisibilityToggled', gameState.isMapFullyVisible);

            saveStateDebounced(); 
            socket.emit('saveSuccess', 'Board cleared successfully.');
        } else {
            socket.emit('error', 'Only the DM can clear the board.');
        }
    });


    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);

        // Remove from connected sets/maps
        connectedDMs.delete(socket.id);
        // Remove the socket ID and username from the map of active players
        connectedPlayers.delete(socket.id);
        console.log(`Removed socket ${socket.id} from active players. Reason: ${reason}`);


        // Broadcast updated list of connected client usernames
        io.emit('clients', Array.from(connectedPlayers.values()));
    });

    // Optional: Add a ping/pong handler if needed for monitoring latency
    // socket.on('ping', (callback) => { callback(); });
});

// Export for Electron (and potentially other uses)
module.exports = { server, io, loadState, saveStateImmediate };