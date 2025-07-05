/* global io, JSZip */
// Ensure the entire script runs after the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	// Check if running in Electron via preload script
	const isElectron = typeof window.electronAPI !== 'undefined';
	console.log('isElectron:', isElectron);

	let serverUrl = ''; // Will be determined dynamically
	let socket = null; // Initialize socket variable
	let username = null;
	let currentRole = null;
	let isMapFullyVisible = false;

	// Suppress Autofill errors to clean up console
	console.error = (function (originalError) {
		return function (...args) {
			if (typeof args[0] === 'string' && args[0].includes('Autofill')) {
				return;
			}
			originalError.apply(console, args);
		};
	})(console.error);
	
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
		
		// --- Helper to check if a cell is adjacent to an owned player token ---
		// Used for highlighting walls near players
		function isAdjacentToOwnedPlayerToken(wallX, wallY, tokensData, username, currentRole) {
			// This check is only relevant for players
			if (currentRole !== 'player') return false;

			// Filter for tokens owned by the current player or their minions
			const ownedPlayerTokens = tokensData.filter(token =>
				token.owner === username || (token.isMinion && token.parentOwner === username)
			);

			// Iterate through each owned player token
			for (const playerToken of ownedPlayerTokens) {
				const tokenSize = playerToken.size || 1;

				// Check all cells the player token occupies and the 8 adjacent cells
				// We iterate a 3x3 area centered around each cell the token occupies
				for (let tokenCellY = playerToken.y; tokenCellY < playerToken.y + tokenSize; tokenCellY++) {
						for (let tokenCellX = playerToken.x; tokenCellX < playerToken.x + tokenSize; tokenCellX++) {

							// Iterate through the 3x3 area around *this* token cell
							for (let dy = -1; dy <= 1; dy++) {
								for (let dx = -1; dx <= 1; dx++) {
									const adjacentX = tokenCellX + dx;
									const adjacentY = tokenCellY + dy;

									// Skip the cells *occupied by the token itself*
									if (adjacentX >= playerToken.x && adjacentX < playerToken.x + tokenSize &&
										adjacentY >= playerToken.y && adjacentY < playerToken.y + tokenSize) {
										continue;
									}

									// Check if this adjacent cell is the wall cell we're looking at
									if (adjacentX === wallX && adjacentY === wallY) {
										return true; // The wall cell is adjacent to this owned token!
									}
								}
							}
						}
				}
			}

			// If we checked all owned tokens and none were adjacent to this wall cell
			return false;
		}

	// Load Socket.IO client library dynamically
	function loadSocketIO() {
		return new Promise((resolve, reject) => {
			if (typeof io !== 'undefined') {
				console.log('Socket.IO already loaded');
				resolve();
				return;
			}

			// Socket.IO client is served by the server itself at /socket.io/socket.io.js
			// This ensures we get the correct version matching the server.
			const socketIoUrl = `${window.location.protocol}//${window.location.host}/socket.io/socket.io.js`;
			const script = document.createElement('script');
			script.src = socketIoUrl;
			script.async = true;
			script.onload = () => {
				console.log('Socket.IO client library loaded');
				resolve();
			};
			script.onerror = () => {
				console.error('Failed to load Socket.IO client library from', socketIoUrl);
				showNotification('Failed to load Socket.IO. Please refresh the page.', true);
				reject(new Error('Failed to load Socket.IO'));
			};
			document.head.appendChild(script);
		});
	}


	async function determineServerUrl() {
		const serverAddressDisplay = document.getElementById('server-address-display'); // Get the element here

		// Always ensure socket.io is loaded before attempting connection or IPC
		try {
			await loadSocketIO();
		} catch (err) {
			console.error("Cannot proceed without Socket.IO:", err);
			if (serverAddressDisplay) {
					serverAddressDisplay.innerHTML = '<strong>Server Address:</strong><br>Failed to load Socket.IO client library.';
			}
			return; // Stop execution if socket.io fails to load
		}


		if (isElectron) {
			try {
				// Call the IPC handler to get addresses
				const addressInfo = await window.electronAPI.getServerAddress();
				console.log('Received address info from main:', addressInfo);

				// Use the localhost address for the Electron window's connection URL
				serverUrl = addressInfo.local; // Connect to localhost from within Electron

				// Update the display element using the received info
				if (serverAddressDisplay) {
						let html = '<strong>Server Addresses:</strong><br>'; // Use plural
						// Always show localhost address for debugging/direct access
						html += `Local: <span id="localhost-address-text">${addressInfo.local}</span>`;

						// Check for *any* non-local addresses first
						if (addressInfo.allLan && addressInfo.allLan.length > 0) {
							// Show primary LAN if it's distinct and preferred
							if (addressInfo.primaryLan && !addressInfo.primaryLan.includes('127.0.0.1') && addressInfo.primaryLan !== addressInfo.local) { // Ensure it's a public/LAN IP and different from localhost
								html += `<br>Network: <span id="primary-lan-address-text">${addressInfo.primaryLan}</span>`;
								// Add helper text below the preferred one
								html += `<br><span style="font-size: 0.9em;">(Share this with players on your network)</span>`;
							} else {
								html += `<br>Network: <span id="lan-address-text">No primary LAN address found</span>`;
								html += `<br><span style="font-size: 0.9em;">(Check network connection/firewall, or try other IPs below)</span>`;
							}

							// List *other* non-local addresses if there are more than the primary one (or if primary was 127.0.0.1/localhost)
							const otherLanAddresses = addressInfo.allLan.filter(addr => addr !== addressInfo.primaryLan && addr !== addressInfo.local);
							if (otherLanAddresses.length > 0) {
								html += `<br><span style="font-size: 0.9em;">(Other network IPs: ${otherLanAddresses.map(addr => addr.replace(/^https?:\/\//, '').replace(/:\d+$/, '')).join(', ')})</span>`;
							}

						} else {
							// No non-local interfaces found at all
							html += `<br>Network: <span id="lan-address-text">No network interfaces found (check connection)</span>`;
						}

						serverAddressDisplay.innerHTML = html;

				} else {
					console.warn('Server Address display element not found.');
				}

			} catch (error) {
				console.error('Error getting server address from main process:', error);
				// Fallback connection URL if IPC fails (shouldn't happen if preload works)
				// Note: config is not available in renderer unless exposed, using hardcoded default port
				const fallbackPort = 4000; // Assume default port if config is not available
				serverUrl = `http://localhost:${fallbackPort}`;
				// Update display on error
				if (serverAddressDisplay) {
					serverAddressDisplay.innerHTML = '<strong>Server Address:</strong><br>';
					serverAddressDisplay.innerHTML += '<span id="lan-address-text">Error retrieving network addresses</span>';
					serverAddressDisplay.innerHTML += `<br>Localhost: ${serverUrl}`;
				} else {
						console.warn('Server Address display element not found during error handling.');
				}
			}
		} else {
			// This section is for standard browser access (outside of Electron)
			// The connection URL is simply the origin the page was loaded from.
			serverUrl = `${window.location.protocol}//${window.location.host}`;

			if (serverAddressDisplay) {
				serverAddressDisplay.innerHTML = '<strong>Connected to:</strong><br>' + serverUrl;
			}
		}

		console.log('Determined Server URL for client connection:', serverUrl);
		initializeSocket(serverUrl); // Initialize socket using the determined serverUrl
	}


	function initializeSocket(url) {
		if (typeof io === 'undefined') {
			console.error('Socket.IO client library not available.');
			showNotification('Error: Cannot connect to server (Socket.IO missing). Please reload.', true);
			return;
		}

		console.log(`Attempting to connect to Socket.IO server at: ${url}`);

		socket = io(url, {
			reconnection: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			timeout: 20000,
			transports: ['websocket', 'polling'],
			query: { clientType: isElectron ? 'electron' : 'browser' }
		});

		// Socket event handlers
		socket.on('connect', () => {
			console.log('Socket connected:', socket.id, 'to URL:', url);
			showNotification('Connected to server!');
			document.getElementById('loginButton').disabled = false;
			document.getElementById('loginButton').textContent = 'Join';
			initializeDarkMode();
			resizeCanvas(); // Ensure canvas size is set on connect
		});

		socket.on('connect_error', (err) => {
			console.error('Socket connection error:', err.message, (err.cause ? `Cause: ${err.cause}` : ''));
			let errorMsg = 'Connection error. Trying to reconnect...';
			if (err.message.includes('xhr poll error') || err.message.includes('websocket error')) {
				errorMsg = 'Network error connecting to server. Retrying...';
			} else if (err.message === 'timeout') {
				errorMsg = 'Connection timed out. Retrying...';
			} else if (err.message.includes('Not allowed by CORS')) {
				errorMsg = 'Connection blocked by CORS. Check server configuration.';
			}
			showNotification(errorMsg, true);
			document.getElementById('loginButton').disabled = true;
			document.getElementById('loginButton').textContent = 'Connecting...';
			// Keep login screen hidden if already logged in, show if not
			if (!username || !currentRole) {
				document.getElementById('loginScreen').classList.remove('hidden');
			}
		});

		socket.on('disconnect', (reason) => {
			console.error('Socket disconnected:', reason);
			let msg = 'Disconnected from server.';
			if (reason === 'io server disconnect') {
				msg = 'Server closed the connection.';
			} else if (reason === 'io client disconnect') {
				msg = 'You disconnected.';
			} else {
				msg = 'Lost connection to server. Attempting to reconnect...';
			}
			if (reason !== 'io client disconnect') {
				showNotification(msg, true);
			}
			document.getElementById('loginButton').disabled = true;
			document.getElementById('loginButton').textContent = 'Disconnected';
			// Always show login screen on disconnect
			document.getElementById('loginScreen').classList.remove('hidden');
			document.body.className = ''; // Clear role class
			// Clear current user/role state on disconnect
			username = null;
			currentRole = null;

		});

		socket.on('reconnect', (attempt) => {
			console.log('Reconnected to server on attempt:', attempt);
			showNotification('Reconnected to server!');
			// Attempt to re-login with stored credentials
			if (username && currentRole) {
				console.log('Attempting to re-login after reconnect...');
				socket.emit('login', { username, role: currentRole });
			} else {
				// If no stored credentials, ensure login screen is visible
				document.getElementById('loginScreen').classList.remove('hidden');
			}
			// Re-enable login button as reconnection is managed by socket.io
			document.getElementById('loginButton').disabled = false;
			document.getElementById('loginButton').textContent = 'Join';
		});

		socket.on('reconnect_attempt', (attempt) => {
			console.log('Reconnect attempt:', attempt);
			// Optional: Show reconnect attempt notification
			// showNotification(`Connection attempt ${attempt}...`, false);
			document.getElementById('loginButton').textContent = `Reconnecting (${attempt})...`;
		});

		socket.on('reconnect_failed', () => {
			console.error('Reconnection failed after multiple attempts');
			showNotification('Failed to reconnect. Please check the server or refresh the page.', true);
			document.getElementById('loginButton').disabled = true;
			document.getElementById('loginButton').textContent = 'Reconnect Failed';
			// Ensure login screen is visible
			document.getElementById('loginScreen').classList.remove('hidden');
		});

		socket.on('ping', () => {
			// console.log('Ping sent to server'); // Keep console clean
		});

		socket.on('pong', (latency) => {
			// console.log('Pong received, latency:', latency, 'ms'); // Keep console clean
		});

		// Game state and UI logic
		let pendingWallChanges = {};
		let tokensData = [];
		let backgroundImage = null;
		let backgroundImageUrl = '';
		let scale = 1;
		let panX = 0;
		let panY = 0;
		let walls = [];
		let isGridVisible = true; // Controls drawing grid lines, not visibility mask
		const canvas = document.getElementById('grid');
		const ctx = canvas.getContext('2d');
		const gridSize = 25; // Pixels per grid cell
		let draggedToken = null;
		let draggedTokenIndex = -1;
		let offsetX, offsetY;
		let isPanning = false;
		let isDrawing = false; // For walls
		let startX, startY; // For pan/draw start
		let currentInteractionMode = 'interact';
		let isLoading = false; // Flag to prevent interaction while loading state
		let hoveredTokenIndex = -1;
		let selectedTokenIndex = -1; // <-- NEW: For persistent click-selection
		let longPressTimeout = null;
		let longPressStartX = 0;
		let longPressStartY = 0;
		let isLongPressing = false;
		let pinchStartDistance = 0;
		let pinchStartScale = 1;
		let pinchStartCenterX = 0;
		let pinchStartCenterY = 0;
		let isContextMenuOpen = false;
		let lastDrawTime = 0;
		let glowFrame = 0; // Used for token glow animation
		let drawPending = false; // Flag to limit redraws

		// --- Visibility Variables ---
		// These Sets store string keys "{x},{y}"
		let brightLightCells = new Set(); // Cells visible in bright light from light sources
		let dimLightCells = new Set();    // Cells visible in dim light from light sources (but not bright)
		let playerVisionCells = new Set(); // Cells visible by player's own inherent vision (e.g., darkvision)
		let playerOwnedCells = new Set(); // NEW: Cells occupied by the current player's owned tokens
		let visibilityMaskCanvas = document.createElement('canvas'); // Offscreen canvas for mask
		let visibilityMaskCtx = visibilityMaskCanvas.getContext('2d');
		let maskDirty = true; // Flag to indicate if the mask needs recalculation

		const gridContainer = document.getElementById('grid-container');
		const addTokenForm = document.getElementById('add-token-form');
		const playerTokenForm = document.getElementById('player-token-form');
		const darkModeToggle = document.getElementById('dark-mode-toggle');
		const controlsContainer = document.getElementById('controls-container');
		const instructionsDiv = document.getElementById('instructions');
		const showControlsButton = document.getElementById('show-controls-button');
		const closeControlsButton = document.getElementById('close-controls-button');
		const controlsWrapper = document.getElementById('controls-wrapper');
		const gridSizeSelect = document.getElementById('grid-size-select');
		const drawWallButton = document.getElementById('draw-wall-button');
		const eraseWallButton = document.getElementById('erase-wall-button');
		const interactButton = document.getElementById('interact-button');
		const toggleGridButton = document.getElementById('toggle-grid-button');
		const toggleAllVisibleButton = document.getElementById('toggle-all-visible-button');
		console.log("toggleAllVisibleButton element:", toggleAllVisibleButton); // DEBUG LOG: Is button element found?
		const resetViewButton = document.getElementById('reset-view-button');
		const backgroundForm = document.getElementById('background-form');
		const backgroundImageUrlInput = document.getElementById('background-image-url');
		const backgroundImageFileInput = document.getElementById('background-image-file');
		const loadBackgroundButton = document.getElementById('load-background-button');
		const clearBackgroundButton = document.getElementById('clear-background-button');
		const saveStateButton = document.getElementById('save-state-button');
		const downloadStateButton = document.getElementById('download-state-button');
		const importStateButton = document.getElementById('import-state-button');
		const importStateFile = document.getElementById('import-state-file');
		const notificationDiv = document.getElementById('notification');
		const serverAddressDisplay = document.getElementById('server-address-display');
		const clearBoardButtonElement = document.getElementById('clear-board-button');


		const gridSizeOptions = {
			micro: { width: 20, height: 15 },
			small: { width: 40, height: 30 }, // Landscape
			medium: { width: 70, height: 40 },
			large: { width: 100, height: 55 },
			'extra-large': { width: 140, height: 70 },
			// Portrait options:
			'small-portrait': { width: 30, height: 40 },
			'medium-portrait': { width: 40, height: 70 },
			'large-portrait': { width: 55, height: 100 },
			'extra-large-portrait': { width: 70, height: 140 },
		};
		
		// custom gridSize
		const customSizeInputsDiv = document.getElementById('custom-size-inputs');
		const customWidthInput = document.getElementById('custom-width');
		const customHeightInput = document.getElementById('custom-height');
		const applyCustomSizeButton = document.getElementById('apply-custom-size');

		let currentGridWidthCells = gridSizeOptions.small.width;
		let currentGridHeightCells = gridSizeOptions.small.height;

		// ADD this new function to your <script> block in multitg.html

		// We need a single, persistent AudioContext for performance.
		const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

		function generateAndPlayHitSound() {
			if (!audioCtx) {
				console.warn("Web Audio API not supported.");
				return;
			}

			// --- Sound Parameters (You can tweak these!) ---
			const duration = 0.15; // Total sound duration in seconds
			const startFrequency = 440; // Pitch of the sound (A4 note)
			const endFrequency = 120; // Pitch to slide down to for a "thud" effect
			const volume = 0.3; // Keep volume reasonable (0.0 to 1.0)

			// 1. Create the Oscillator - This is the sound wave source
			const oscillator = audioCtx.createOscillator();
			oscillator.type = 'square'; // 'square' gives a retro, sharp, "blip" sound. 'sine' is softer.

			// 2. Create the Gain Node - This is the volume control
			const gainNode = audioCtx.createGain();

			// 3. Connect the parts: Oscillator -> Volume -> Speakers
			oscillator.connect(gainNode);
			gainNode.connect(audioCtx.destination);

			// 4. Schedule the sound changes over time
			const now = audioCtx.currentTime;

			// Set initial volume and pitch
			gainNode.gain.setValueAtTime(volume, now);
			oscillator.frequency.setValueAtTime(startFrequency, now);

			// Schedule the pitch to drop quickly for a "hit" or "thud" effect
			oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.8);
			
			// Schedule the volume to fade out to (almost) zero
			gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

			// 5. Start the sound now and schedule it to stop after its duration
			oscillator.start(now);
			oscillator.stop(now + duration);
		}


		function showNotification(message, isError = false) {
			notificationDiv.textContent = message;
			notificationDiv.classList.toggle('error', isError);
			notificationDiv.style.display = 'block';
			setTimeout(() => {
				notificationDiv.style.display = 'none';
				notificationDiv.classList.remove('error');
			}, 3000);
		}

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


		function initializeDarkMode() {
			const isDarkMode = localStorage.getItem('darkMode') === 'true';
			document.body.classList.toggle('dark-mode', isDarkMode);
			darkModeToggle.textContent = isDarkMode ? 'Light Mode' : 'Dark Mode';
			updateDarkModeStyles(isDarkMode);
			// drawGrid(); // No need to draw here, init or resizeCanvas will draw
		}

		function updateDarkModeStyles(isDarkMode) {
			document.querySelectorAll('#add-token-form, #player-token-form, #background-form, #instructions, #controls-container, #loginScreen, #show-controls-button, #notification, #server-address-display').forEach(el => {
				el.classList.toggle('dark-mode', isDarkMode);
			});
			canvas.classList.toggle('dark-mode', isDarkMode);
		}

		function imageToDataUrl(file, callback) {
			if (!file) {
				callback(null);
				return;
			}
			const reader = new FileReader();
			reader.onload = () => callback(reader.result);
			reader.onerror = () => {
				console.error('Failed to read file:', file.name);
				callback(null);
			};
			reader.readAsDataURL(file);
		}

		function preloadTokenImage(tokenData) {
			if (tokenData.imageUrl) {
				const img = new Image();
				
				// --- NEW CRITICAL FIX ---
				// Check if the imageUrl is an absolute file path.
				// If so, convert it to a relative web path.
				let finalUrl = tokenData.imageUrl;
				if (finalUrl.startsWith('file:///') || finalUrl.match(/^[a-zA-Z]:\\/)) {
					// It's a local file path. Extract just the 'images/...' part.
					const imagesIndex = finalUrl.lastIndexOf('images/');
					if (imagesIndex !== -1) {
						finalUrl = finalUrl.substring(imagesIndex);
					}
				}
				// Ensure forward slashes for the URL
				finalUrl = finalUrl.replace(/\\/g, '/');
				img.src = finalUrl;
				// --- END FIX ---
				
				img.onload = () => {
					tokenData.imageObj = img;
					if (currentRole === 'player' && (tokenData.owner === username || tokenData.isLightSource)) {
						maskDirty = true;
					}
					drawGrid();
				};
				img.onerror = () => {
					console.warn(`Failed to load token image: ${img.src}`);
					tokenData.imageObj = null;
					drawGrid();
				};
			} else {
				tokenData.imageObj = null;
			}
		}

		function resizeCanvas() {
			canvas.width = document.documentElement.clientWidth;
			canvas.height = document.documentElement.clientHeight;
			// The mask canvas size needs to match the total grid pixel size
			visibilityMaskCanvas.width = currentGridWidthCells * gridSize;
			visibilityMaskCanvas.height = currentGridHeightCells * gridSize;
			maskDirty = true; // Mask size changed, needs recalculation
			drawGrid(); // Redraw after resize
		}

		function loadBackgroundImage(url) {
			if (!url) {
				backgroundImage = null;
				backgroundImageUrl = '';
				drawGrid();
				return;
			}

			const img = new Image();
			img.onload = () => {
				backgroundImage = img;
				backgroundImageUrl = url;
				if (url && !url.startsWith('data:')) {
					backgroundImageUrlInput.value = url;
				} else {
					backgroundImageUrlInput.value = ''; // Clear URL field if it's a data URL
				}
				drawGrid();
			};
			img.onerror = () => {
				console.error(`Failed to load background image from: ${url}`);
				showNotification('Failed to load background image.', true);
				backgroundImage = null;
				backgroundImageUrl = '';
				drawGrid();
			};
			img.src = url;
		}

		// --- Basic Line of Sight Algorithm ---
		function isLOSClear(x0, y0, x1, y1, walls, gridWidth, gridHeight) {
			// Check boundaries first
			if (x0 < 0 || x0 >= gridWidth || y0 < 0 || y0 >= gridHeight ||
				x1 < 0 || x1 >= gridWidth || y1 < 0 || y1 >= gridHeight) {
				return false;
			}
			// A point always has line of sight to itself.
			if (x0 === x1 && y0 === y1) return true;

			// Bresenham's line algorithm setup
			const dx = Math.abs(x1 - x0);
			const dy = Math.abs(y1 - y0);
			const sx = (x0 < x1) ? 1 : -1;
			const sy = (y0 < y1) ? 1 : -1;
			let err = dx - dy;

			let x = x0;
			let y = y0;

			// Loop along the line from start to end
			while (true) {
				// If the cell we are about to check is the destination, then we've successfully
				// reached it without hitting an intermediate wall. The path is clear.
				if (x === x1 && y === y1) {
					return true;
				}
				
				// This is an intermediate cell on the path. Check if it's a wall.
				if (walls[y] && walls[y][x] === 1) {
						// But we must exclude the very first cell (the origin) from being a blocker
					if (x !== x0 || y !== y0) {
						return false; // Blocked by an intermediate wall
					}
				}

				// Calculate the next step on the line (do this *after* checking the current cell)
				const e2 = 2 * err;
				if (e2 > -dy) {
					err -= dy;
					x += sx;
				}
				if (e2 < dx) {
					err += dx;
					y += sy;
				}
			}
		}

		// --- Calculate Visible Cells (Modified for Layered Light/Vision and Owned Cells) ---
		function calculateVisibleCells() {
			// For DM or when "Show Map" is on, no fog is needed. Clear all visibility sets.
			if (currentRole === 'dm' || isMapFullyVisible) {
				brightLightCells.clear();
				dimLightCells.clear();
				playerVisionCells.clear();
				playerOwnedCells.clear();
				maskDirty = true;
				return;
			}

			// --- Step 1: Clear previous visibility data ---
			brightLightCells.clear();
			dimLightCells.clear();
			playerVisionCells.clear(); // This set will now be correctly used for dim sight
			playerOwnedCells.clear();

			// --- Step 2: Identify the current player's tokens and all light sources on the map ---
			const myOwnedTokens = tokensData.filter(token =>
				token.owner === username || (token.isMinion && token.parentOwner === username)
			);
			const allLightSources = tokensData.filter(token => token.isLightSource && (token.brightRange > 0 || token.dimRange > 0));

			const gridWidth = currentGridWidthCells;
			const gridHeight = currentGridHeightCells;

			// --- Step 3: Populate cells occupied by the player's own tokens ---
			// This ensures the player always sees the square their token is on.
			myOwnedTokens.forEach(token => {
				const tokenSize = token.size || 1;
				for (let dy = 0; dy < tokenSize; dy++) {
					for (let dx = 0; dx < tokenSize; dx++) {
						playerOwnedCells.add(`${token.x + dx},${token.y + dy}`);
					}
				}
			});

			// --- Step 4: Calculate visibility from ALL light sources on the map ---
			// Players can see by the light of their allies' torches.
			allLightSources.forEach(sourceToken => {
				const sx = sourceToken.x;
				const sy = sourceToken.y;
				const brightRange = sourceToken.brightRange || 0;
				const dimRange = Math.max(brightRange, sourceToken.dimRange || 0);

				const startX = Math.max(0, sx - dimRange);
				const endX = Math.min(gridWidth - 1, sx + dimRange);
				const startY = Math.max(0, sy - dimRange);
				const endY = Math.min(gridHeight - 1, sy + dimRange);

				for (let y = startY; y <= endY; y++) {
					for (let x = startX; x <= endX; x++) {
						const dist = Math.max(Math.abs(x - sx), Math.abs(y - sy));
						if (dist > dimRange) continue;

						if (isLOSClear(sx, sy, x, y, walls, gridWidth, gridHeight)) {
							const cellKey = `${x},${y}`;
							if (dist <= brightRange) {
								brightLightCells.add(cellKey);
							} else {
								dimLightCells.add(cellKey);
							}
						}
					}
				}
			});

			// --- Step 5: Calculate inherent sight (e.g., Darkvision) for ONLY the player's OWNED tokens ---
			myOwnedTokens.forEach(playerToken => {
				// IMPORTANT: If a token is a light source, its vision is defined by light, not innate sight.
				if (playerToken.isLightSource) return;

				const px = playerToken.x;
				const py = playerToken.y;
				// Convert sight from feet (e.g., 60) to cells (e.g., 12), assuming 5ft per cell.
				const sightRadiusInCells = Math.floor((playerToken.sightRadius || 0) / 5);

				if (sightRadiusInCells <= 0) return;

				const startX = Math.max(0, px - sightRadiusInCells);
				const endX = Math.min(gridWidth - 1, px + sightRadiusInCells);
				const startY = Math.max(0, py - sightRadiusInCells);
				const endY = Math.min(gridHeight - 1, py + sightRadiusInCells);

				for (let y = startY; y <= endY; y++) {
					for (let x = startX; x <= endX; x++) {
						const dist = Math.max(Math.abs(x - px), Math.abs(y - py));
						if (dist > sightRadiusInCells) continue;
						
						if (isLOSClear(px, py, x, y, walls, gridWidth, gridHeight)) {
							// Add to playerVisionCells. We will treat this as dim light later.
							playerVisionCells.add(`${x},${y}`);
						}
					}
				}
			});
			
			// --- Step 6: Finalize the dimLightCells set ---
			// A cell is dim if it's in the initial dim light set OR in the player's inherent vision set,
			// AS LONG AS it's not also in a bright light area.
			playerVisionCells.forEach(cellKey => {
				dimLightCells.add(cellKey);
			});

			brightLightCells.forEach(cellKey => {
				dimLightCells.delete(cellKey); // Bright light overrides dim.
			});

			// The `playerVisionCells` set is no longer needed after this point, but we keep its data
			// within the `dimLightCells` set for the mask rendering.

			maskDirty = true; // Flag that the mask needs to be redrawn.
		}

		// --- Build the Visibility Mask Canvas (Corrected Logic & Fixed Typos) ---
		// This function creates a mask canvas where each pixel's alpha determines visual appearance:
		// alpha = 0   -> Fully Visible (Bright Light OR Player's OWN Token Location OR Adjacent Wall)
		// alpha = 0.6 -> Dimmed (Dim Light)
		// alpha = 1   -> Solid Black Fog (Not Visible at all OR Player Inherent Vision Alone)
									// --- Build the Visibility Mask Canvas ---
		// This function creates a mask canvas where each pixel's alpha determines visual appearance:
		// alpha = 0   -> Fully Visible (Bright Light OR Player's OWN Token Location OR Adjacent Wall revealed by vision/light)
		// alpha = 0.6 -> Dimmed (Dim Light)
		// alpha = 1   -> Solid Black Fog (Not Visible at all)
		
		function isAdjacentToKnowableCell(wallX, wallY) {
			// Check the 8 neighbors of the given wall cell
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					// Skip the wall cell itself
					if (dx === 0 && dy === 0) continue;

					const checkX = wallX + dx;
					const checkY = wallY + dy;

					// Check if neighbor is within grid bounds
					if (checkX < 0 || checkX >= currentGridWidthCells || checkY < 0 || checkY >= currentGridHeightCells) {
						continue;
					}

					// The crucial check:
					// 1. Is the neighboring cell NOT a wall?
					// 2. Is that non-wall cell "knowable" (i.e., within vision/light range)?
					if ((!walls[checkY] || walls[checkY][checkX] !== 1) && isCellKnowable(checkX, checkY)) {
						return true; // Yes, this wall is next to a visible floor tile.
					}
				}
			}
			return false; // No adjacent knowable floor tiles were found.
		}
		
		function buildVisibilityMask() {
			// No mask needed for DM or when 'Show Map' is on
			if (currentRole === 'dm' || isMapFullyVisible) {
				visibilityMaskCtx.clearRect(0, 0, visibilityMaskCanvas.width, visibilityMaskCanvas.height);
				maskDirty = false; // Mask is now clear (effectively off)
				return;
			}

				if (!maskDirty) return; // Only rebuild if necessary

				const gridPixelWidth = currentGridWidthCells * gridSize;
				const gridPixelHeight = currentGridHeightCells * gridSize;

				visibilityMaskCanvas.width = gridPixelWidth;
				visibilityMaskCanvas.height = gridPixelHeight;
				visibilityMaskCtx.clearRect(0, 0, gridPixelWidth, gridPixelHeight); // Start with a fully transparent canvas

				const dimmingOpacity = 0.6; // Opacity for the dim areas (60% black fog overlay)


				// Iterate through all grid cells and draw the appropriate mask pixel
				for (let y = 0; y < currentGridHeightCells; y++) {
					for (let x = 0; x < currentGridWidthCells; x++) {
						const cellKey = `${x},${y}`;
						let maskOpacity = 1; // Default to full fog (opaque black)

						// Determine base opacity based on light/vision precedence
						// Bright Light > Dim Light > Full Fog (for anything else)
						if (brightLightCells.has(cellKey)) {
							maskOpacity = 0; // Fully transparent in bright light
						}
						else if (dimLightCells.has(cellKey)) {
							maskOpacity = dimmingOpacity; // Semi-transparent in dim light
						}


						// Override mask opacity if this cell is occupied by the CURRENT PLAYER's token(s)
						// This ensures the owned token's space is always fully clear visually.
						if (playerOwnedCells.has(cellKey)) {
							maskOpacity = 0; // Make player's *own* token squares fully clear, regardless of other lighting/vision
						}

						// Check if this cell is a wall AND it is knowable (visible by vision/light or owned token)
						// If so, make the mask transparent to reveal the underlying wall (drawn dimmed in drawGrid)
						// unless it's already fully transparent (e.g., by bright light or owned cell override).
						// We check `walls[y] && walls[y][x] === 1` to ensure it's actually a wall cell.
						// We check `isCellKnowable(x, y)` to see if the *player's vision/light* reveals this wall cell.
						// Note: Player-owned cells already result in maskOpacity = 0.
						if (maskOpacity > 0 && // Only modify if not already clear
							walls[y] && walls[y][x] === 1 &&
							isAdjacentToKnowableCell(x, y)) // <--- USE THE NEW HELPER FUNCTION HERE
						{
							maskOpacity = 0; // Make the mask clear to reveal the wall
						}


						// Draw the mask pixel with the determined opacity (0=clear, dimmingOpacity=dim, 1=fog)
						visibilityMaskCtx.fillStyle = `rgba(0, 0, 0, ${maskOpacity})`;
						visibilityMaskCtx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
					}
				}

				maskDirty = false; // Mask is now up-to-date
		}

		// --- Main Drawing Function ---
		function drawGrid() {
			// Prevent multiple redraw calls queued up
			if (drawPending) return;
			drawPending = true;

			// Request the next animation frame
			requestAnimationFrame(() => {
				const now = performance.now();
				// Update glow animation frame based on time for animations
				glowFrame = now / 1000;

				// Clear the entire canvas to start fresh for this frame
				// This is done in the identity transform space (before pan/zoom)
				ctx.clearRect(0, 0, canvas.width, canvas.height);

				// --- Apply Main Pan and Scale Transformations ---
				// Save the canvas state *before* applying pan and scale.
				// This saved state represents the identity transform and no clipping.
				ctx.save();
				ctx.translate(panX, panY); // Apply user pan (shifts the canvas origin)
				ctx.scale(scale, scale); // Apply user zoom (scales subsequent drawing operations)

				// Calculate the total size of the grid area in pixels at a 1:1 scale.
				// This is the target area in the *transformed space* that we want to draw within.
				const gridPixelWidth = currentGridWidthCells * gridSize;
				const gridPixelHeight = currentGridHeightCells * gridSize;

				// --- Set Clipping Region to the Grid Area ---
				// Define a rectangle for the clipping path.
				// The coordinates (0,0) and dimensions (gridPixelWidth, gridPixelHeight)
				// are interpreted in the *current transformed coordinate system*.
				// This rectangle represents the visual bounds of the grid on the screen.
				ctx.beginPath(); // Start a new path for the clipping shape
				ctx.rect(0, 0, gridPixelWidth, gridPixelHeight); // Define the rectangle shape
				ctx.clip(); // Apply this path as the current clipping path.
							// ONLY drawing operations that occur *after* this `clip()` call
							// will be restricted to the area defined by this path.
							// The clipping path itself is also subject to the current transform.


				// --- Draw Content Within the Clipped Grid Area ---

				// 1. Draw Background Image (will be clipped to the grid area)
				//    This uses the 'cover' logic to scale the image to fit the grid aspect ratio
				if (backgroundImage && backgroundImage.complete && backgroundImage.naturalWidth !== 0) {
					const gridAspectRatio = gridPixelWidth / gridPixelHeight;
					const imageAspectRatio = backgroundImage.width / backgroundImage.height;

					let drawWidth, drawHeight, offsetX, offsetY;

					// Calculate dimensions to make the image "cover" the entire grid area.
					// One dimension will match the grid, the other will be larger or equal.
					if (imageAspectRatio > gridAspectRatio) {
						// Image is proportionally wider than grid: Scale height to match grid, width will be larger.
						drawHeight = gridPixelHeight;
						drawWidth = drawHeight * imageAspectRatio;
					} else {
						// Image is proportionally taller or same as grid: Scale width to match grid, height will be larger or equal.
						drawWidth = gridPixelWidth;
						drawHeight = drawWidth / imageAspectRatio;
					}

					// Calculate offset to center the scaled image within the grid area (0,0 to gridPixelWidth, gridPixelHeight).
					// If the image dimension is larger than the grid, the offset will be negative, positioning the image partially outside the clip area, which gets cropped.
					offsetX = (gridPixelWidth - drawWidth) / 2;
					offsetY = (gridPixelHeight - drawHeight) / 2;

					// Draw the image. Its destination rectangle (offsetX, offsetY, drawWidth, drawHeight)
					// is relative to the transformed origin (which is the top-left of the grid area in this transformed space).
					// The image will be automatically clipped by the `ctx.clip()` applied above.
					ctx.drawImage(backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
				}

				// 2. Draw Grid Lines (will be clipped)
				//    These are drawn after the background layer.
				if (isGridVisible) {
					const gridColor = document.body.classList.contains('dark-mode') ? 'rgba(85, 85, 85, 0.7)' : 'rgba(204, 204, 204, 0.7)';
					ctx.strokeStyle = gridColor;
					// Line width scales inversely with zoom to maintain apparent thickness
					ctx.lineWidth = 1 / scale;

					for (let i = 0; i <= currentGridWidthCells; i++) {
						const x = i * gridSize;
						ctx.beginPath();
						// Drawing coordinates are relative to the transformed origin (top-left of grid area)
						ctx.moveTo(x, 0);
						ctx.lineTo(x, gridPixelHeight);
						ctx.stroke();
					}
					for (let i = 0; i <= currentGridHeightCells; i++) {
						const y = i * gridSize;
						ctx.beginPath();
						// Drawing coordinates are relative to the transformed origin (top-left of grid area)
						ctx.moveTo(0, y);
						ctx.lineTo(gridPixelWidth, y);
						ctx.stroke();
					}
				}

				// 3. Draw Walls (will be clipped)
				//    These are drawn after grid lines, before tokens.
				// --- MODIFIED WALL DRAWING FOR ADJACENCY HIGHLIGHT ---
				let wallColorBase = document.body.classList.contains('dark-mode') ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)'; // Standard wall color/opacity
				let wallColorAdjacent = document.body.classList.contains('dark-mode') ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 255, 0.6)'; // Slightly less opaque for adjacent
				const isPlayer = currentRole === 'player';

				for (let y = 0; y < currentGridHeightCells; y++) {
					for (let x = 0; x < currentGridWidthCells; x++) {
						if (walls[y] && walls[y][x] === 1) {
							// Determine color/opacity based on role and adjacency
							let wallFillColor = wallColorBase;
							// Only highlight adjacent walls for players when FoW is active ('Show Map' is OFF)
							if (isPlayer && !isMapFullyVisible && isAdjacentToOwnedPlayerToken(x, y, tokensData, username, currentRole)) {
									wallFillColor = wallColorAdjacent;
							}

							ctx.fillStyle = wallFillColor;
							// Coordinates are relative to transformed origin (top-left of grid area)
							ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
						}
					}
				}

				// --- START FOW CALCULATION FOR PLAYERS ---
				// Calculate visibility sets *before* drawing tokens or names for players under FoW
				if (currentRole === 'player' && !isMapFullyVisible) {
					// Only calculate if maskDirty is true, otherwise reuse previous calculation
					if (maskDirty) { // We flag maskDirty whenever visibility criteria change
						calculateVisibleCells(); // This updates brightLightCells, dimLightCells, playerVisionCells, playerOwnedCells
					}
				} else {
					// Clear sets if not player or Show Map is on, ensuring isTokenKnowable works correctly
					brightLightCells.clear();
					dimLightCells.clear();
					playerVisionCells.clear();
					playerOwnedCells.clear();
				}
				// --- END FOW CALCULATION ---


				// --- Draw Tokens (will be clipped) ---
				//    These are drawn after walls.
				tokensData.forEach((tokenData, index) => {
					// Decide if the token should be drawn for this client
					let shouldDrawToken = false;
					const isOwner = tokenData.owner === username || (tokenData.isMinion && tokenData.parentOwner === username);

					if (currentRole === 'dm') {
						shouldDrawToken = true; // DM sees all tokens
					} else { // Player role
						if (isMapFullyVisible) {
							shouldDrawToken = true; // Player sees all tokens if DM has 'Show Map' on
						} else { // Standard player FoW is active (visibility sets populated above)
							// Player sees tokens they own, OR tokens that are knowable through FoW/light calculation
							shouldDrawToken = isOwner || isTokenKnowable(tokenData); // Use the calculated isTokenKnowable here
						}
					}

					if (shouldDrawToken) {
						// Save the current state *including* the main pan/zoom and the grid clipping path
						ctx.save(); // <--- Moved ctx.save() inside the draw condition

						const tokenSize = tokenData.size || 1;
						// Calculate token top-left position relative to transformed origin (top-left of grid area)
						const x = tokenData.x * gridSize;
						const y = tokenData.y * gridSize;
						const width = gridSize * tokenSize;
						const height = gridSize * tokenSize;
						const rotation = (tokenData.rotation || 0) * Math.PI / 180;
						// MODIFIED: A token is "selected" if it's the persistently selected one OR currently hovered
						const isSelected = index === hoveredTokenIndex || index === selectedTokenIndex;
						let hpPercentage = 1;
						const isLowHealth = tokenData.maxHP > 0 && tokenData.hp !== undefined && tokenData.hp / tokenData.maxHP < 0.25;

						// Translate origin to the token's center, relative to the current transformed space (the grid area)
						ctx.translate(x + width / 2, y + height / 2);
						ctx.rotate(rotation);

						// Drawing coordinates are relative to the token's center
						const drawX = -width / 2;
						const drawY = -height / 2;

						// --- DRAW GLOW EFFECT FIRST (if applicable) ---
						// ... (Your existing glow drawing logic using drawX, drawY, width, height - uses current transform & clip) ...
						if (isSelected || isLowHealth) {
							const glowStrength = Math.sin(glowFrame * Math.PI * 2) * 0.2 + 0.8;
							const sizeFactor = Math.min(1 / tokenSize, 1);
							const glowMultiplier = 1 + sizeFactor * 0.8;

							ctx.shadowColor = isSelected
								? (document.body.classList.contains('dark-mode') ? 'rgba(150, 150, 255, 0.8)' : 'rgba(0, 0, 255, 0.6)')
								: 'rgba(255, 50, 50, 0.8)';

							ctx.shadowBlur = 50 * glowStrength * glowMultiplier / scale; // Scale blur inversely with zoom

							const baseScale = 1.0;
							const pulseScale = baseScale + (glowStrength * 0.08 * sizeFactor);
							ctx.scale(pulseScale, pulseScale);

							ctx.fillStyle = ctx.shadowColor;
							if (tokenSize === 1) { ctx.beginPath(); ctx.arc(0, 0, width / 2, 0, Math.PI * 2); ctx.fill(); }
							else { const radius = width * 0.15; ctx.beginPath(); ctx.moveTo(drawX + radius, drawY); ctx.lineTo(drawX + width - radius, drawY); ctx.quadraticCurveTo(drawX + width, drawY, drawX + width, drawY + radius); ctx.lineTo(drawX + width, drawY + height - radius); ctx.quadraticCurveTo(drawX + width, drawY + height, drawX + width - radius, drawY + height); ctx.lineTo(drawX + radius, drawY + height); ctx.quadraticCurveTo(drawX, drawY + height, drawX, drawY + height - radius); ctx.lineTo(drawX, drawY + radius); ctx.quadraticCurveTo(drawX, drawY, drawX + radius, drawY); ctx.closePath(); ctx.fill(); }

							ctx.shadowBlur = 0;
							ctx.shadowColor = 'transparent';
						}

						// Inside drawGrid -> tokensData.forEach -> if (shouldDrawToken)
						// --- DRAW TOKEN IMAGE/COLOR (ON TOP) ---
						if (tokenData.imageObj && tokenData.imageObj.complete && tokenData.imageObj.naturalWidth !== 0) {
							// Draw image (already defines its own area implicitly)
							ctx.drawImage(tokenData.imageObj, drawX, drawY, width, height);
						} else {
							// *** FIX START ***
							// Explicitly define the path for the color fill.
							// Use the same drawX, drawY, width, height calculated earlier,
							// which are relative to the token's translated center.
							ctx.beginPath(); // Start a new path just for this fill operation
							ctx.rect(drawX, drawY, width, height); // Define the rectangle path
							// *** FIX END ***

							// Now set color and fill the *just defined* path
							ctx.fillStyle = tokenData.backgroundColor || 'grey';
							ctx.fill(); // Fills the rectangle defined above
						}

						// --- APPLY RED TINT (ON TOP of image/color) ---
						if (tokenData.maxHP > 0 && tokenData.hp !== undefined) {
								hpPercentage = Math.max(0, Math.min(1, tokenData.hp / tokenData.maxHP)); const redTint = 1 - hpPercentage;
								if (redTint > 0) {
									ctx.globalCompositeOperation = 'source-atop';
									if (tokenSize === 1) { ctx.beginPath(); ctx.arc(0, 0, width / 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(255, 0, 0, ${redTint * 0.5})`; ctx.fill(); }
									else { const radius = width * 0.15; ctx.beginPath(); ctx.moveTo(drawX + radius, drawY); ctx.lineTo(drawX + width - radius, drawY); ctx.quadraticCurveTo(drawX + width, drawY, drawX + width, drawY + radius); ctx.lineTo(drawX + width, drawY + height - radius); ctx.quadraticCurveTo(drawX + width, drawY + height, drawX + width - radius, drawY + height); ctx.lineTo(drawX + radius, drawY + height); ctx.quadraticCurveTo(drawX, drawY + height, drawX, drawY + height - radius); ctx.lineTo(drawX, drawY + radius); ctx.quadraticCurveTo(drawX, drawY, drawX + radius, drawY); ctx.closePath(); ctx.fillStyle = `rgba(255, 0, 0, ${redTint * 0.5})`; ctx.fill(); }
									ctx.globalCompositeOperation = 'source-over';
								}
						}

						// --- DRAW SELECTION OUTLINE (ON TOP of everything) ---
						if (isSelected) {
								ctx.strokeStyle = document.body.classList.contains('dark-mode') ? 'cyan' : 'blue';
								ctx.lineWidth = 2 / scale;
								if (tokenSize === 1) { ctx.beginPath(); ctx.arc(0, 0, width / 2, 0, Math.PI * 2); ctx.stroke(); }
								else { const radius = width * 0.15; ctx.beginPath(); ctx.moveTo(drawX + radius, drawY); ctx.lineTo(drawX + width - radius, drawY); ctx.quadraticCurveTo(drawX + width, drawY, drawX + width, drawY + radius); ctx.lineTo(drawX + width, drawY + height - radius); ctx.quadraticCurveTo(drawX + width, drawY + height, drawX + width - radius, drawY + height); ctx.lineTo(drawX + radius, drawY + height); ctx.quadraticCurveTo(drawX, drawY + height, drawX, drawY + height - radius); ctx.lineTo(drawX, drawY + radius); ctx.quadraticCurveTo(drawX, drawY, drawX + radius, drawY); ctx.closePath(); ctx.stroke(); }
						}

						ctx.restore(); // Restore the state saved just for this token
					}
					// If !shouldDrawToken, nothing is drawn and ctx.save()/ctx.restore() were skipped, which is correct.
				});


				// --- Apply Visibility Mask (will be clipped) ---
				// Only apply mask for players. It will be clipped by the grid area clip path.
				if (currentRole === 'player' && !isMapFullyVisible) { // Only apply mask when player and Show Map is OFF
						// Recalculate and build mask if needed (maskDirty checked at the start of the player block)
						if (maskDirty) {
							buildVisibilityMask(); // Builds a mask with varying transparency using the sets calculated above
						}
						// Draw the mask canvas over the grid area (0,0 to gridPixelWidth, gridPixelHeight)
						// It will be clipped by the grid area clip path.
						ctx.drawImage(visibilityMaskCanvas, 0, 0, gridPixelWidth, gridPixelHeight);
				} else {
						// DM or Player with Show Map ON: ensure mask is effectively off (cleared in buildVisibilityMask)
						maskDirty = false; // Ensure flag is false when mask isn't being used/drawn
				}


				// Restore the canvas state saved at the beginning.
				// This removes the main pan/zoom transformations and the grid clipping path.
				ctx.restore();


				// Update token names (DOM elements, drawn outside the canvas)
				// This happens after the canvas drawing is complete.
				// Token names are *not* subject to canvas clipping, they are separate HTML elements.
				updateTokenNames();
				drawPending = false;

				// Continue drawing loop
				// Request the next animation frame to keep the canvas updated
				requestAnimationFrame(drawGrid);
			});
		}

		// --- Helper to check if any cell a token occupies is in Bright Light ---
			function isTokenInBrightLight(token) {
				const tokenSize = token.size || 1;
				const gridWidth = currentGridWidthCells;
				const gridHeight = currentGridHeightCells;
				for (let dy = 0; dy < tokenSize; dy++) {
					for (let dx = 0; dx < tokenSize; dx++) {
						const cellX = token.x + dx;
						const cellY = token.y + dy;
						// Check boundaries and if the cell key is in the bright set
						if (cellX >= 0 && cellX < gridWidth && cellY >= 0 && cellY < gridHeight) {
							const cellKey = `${cellX},${cellY}`;
							if (brightLightCells.has(cellKey)) {
								return true; // Found at least one bright cell
							}
						}
					}
				}
				return false; // No occupied cell is in bright light
			}


		// --- Helper to check if a cell is visible (knowable) to the current player ---
		// This function determines if a cell is *knowable* (can see tokens/walls there), not its visual brightness.
		// Used for interaction checks and general token knowability.
		// --- Helper to check if a cell is visible (knowable) under FOW rules ---
		// Does NOT consider DM role or isMapFullyVisible here.
		// Assumes necessary visibility sets (brightLightCells, dimLightCells, playerVisionCells, playerOwnedCells) are globally available.
		function isCellKnowable(x, y) {
			const cellKey = `${x},${y}`;
			// A cell is *knowable* if it's in bright, dim, OR player vision areas, OR is occupied by a player's own token.
			return brightLightCells.has(cellKey) || dimLightCells.has(cellKey) || playerVisionCells.has(cellKey) || playerOwnedCells.has(cellKey);
		}

		// --- Helper to check if *any part* of a token is knowable under FOW rules ---
		// Does NOT consider DM role or isMapFullyVisible here.
			function isTokenKnowable(token) {
			const tokenSize = token.size || 1;
				for (let dy = 0; dy < tokenSize; dy++) {
					for (let dx = 0; dx < tokenSize; dx++) {
						const cellX = token.x + dx;
						const cellY = token.y + dy;
						// Check boundaries before calling isCellKnowable
						if (cellX >= 0 && cellX < currentGridWidthCells && cellY >= 0 && cellY < currentGridHeightCells) {
						if (isCellKnowable(cellX, cellY)) {
							return true; // Found at least one knowable cell
						}
					}
				}
			}
			return false; // No occupied cell is knowable
		}
		
		const rollSoundElement = document.getElementById('roll-sound');
		const diceInputElement = document.getElementById('dice-input');
		const rollDiceButtonElement = document.getElementById('roll-dice-button');
		const diceLogElement = document.getElementById('dice-log');
		const hiddenRollToggleElement = document.getElementById('hidden-roll-toggle'); // Get the toggle

		if (rollDiceButtonElement && diceInputElement && socket) {
			rollDiceButtonElement.addEventListener('click', () => {
				if (!socket || !socket.connected) {
					showNotification('Not connected to server. Cannot roll dice.', true);
					return;
				}
				const diceString = diceInputElement.value.trim();
				// Check if hiddenRollToggleElement exists AND is checked, only if currentRole is 'dm'
				const isHiddenRoll = currentRole === 'dm' && hiddenRollToggleElement && hiddenRollToggleElement.checked;

				if (diceString) {
					socket.emit('rollDice', {
						diceString: diceString,
						isHidden: isHiddenRoll // Send the hidden state
					});
					// diceInputElement.value = ''; 
				} else {
					showNotification('Please enter dice notation to roll.', false);
				}
			});

			diceInputElement.addEventListener('keypress', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					rollDiceButtonElement.click();
				}
			});
		}
		
		// MODIFIED: Apply Damage button logic
		const applyDamageButtonElement = document.getElementById('apply-damage-button');
		if (applyDamageButtonElement && socket) {
			applyDamageButtonElement.addEventListener('click', () => {
				if (!socket || !socket.connected) {
					showNotification('Not connected to server. Cannot apply damage.', true);
					return;
				}

				// MODIFIED: Check if a token is selected using the new persistent `selectedTokenIndex`
				if (selectedTokenIndex === -1) {
					showNotification('Please CLICK to select a token to apply damage to.', false);
					return;
				}
				
				const diceString = diceInputElement.value.trim();
				if (!diceString) {
					showNotification('Please enter a damage roll (e.g., 2d8+5).', false);
					return;
				}

				const targetId = tokensData[selectedTokenIndex].id;

				// Emit a new, specific event for applying damage
				socket.emit('applyDamage', {
					diceString: diceString,
					targetId: targetId
				});
			});
		}
		
		function playDiceSound() {
			if (rollSoundElement) {
				// Check if the audio element is ready to play (optional but good practice)
				if (rollSoundElement.readyState >= 2) { // HAVE_CURRENT_DATA or more
					rollSoundElement.currentTime = 1.5;  // Skips the first 1.5 seconds
					rollSoundElement.play().catch(error => {
						// Autoplay was prevented, or another error.
						// This can happen if the user hasn't interacted with the page yet.
						// Modern browsers often block audio until user interaction.
						console.warn("Dice sound playback failed:", error);
						// You might want to enable sound on first click elsewhere if this is an issue.
					});
				} else {
					console.warn("Dice sound not ready to play.");
					// Optionally, add an event listener for 'canplaythrough' to try again
					// rollSoundElement.addEventListener('canplaythrough', () => playDiceSound(), { once: true });
				}
			}
		}

		socket.on('diceResult', (data) => {
			playDiceSound();
			
			if (diceLogElement) {
				const rollEntry = document.createElement('p');
				const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				let messageHtml = "";

				// Embed data into the element for the click listener
				if (typeof data.total === 'number' && !isNaN(data.total)) {
					rollEntry.dataset.total = data.total;
					rollEntry.dataset.roller = data.roller; // Store who rolled it
				}

				if (data.isHiddenByDM && data.forPlayerView && currentRole !== 'dm') {
					messageHtml = `[${time}] <strong>${data.roller}</strong> rolled <em>${data.input || 'dice'}</em>:<br>  ${data.output}`;
				} else if (data.isHiddenByDM && !data.forPlayerView && currentRole === 'dm' && data.roller === username) {
					messageHtml = `[${time}] <strong>${data.roller}</strong> rolled <em>${data.input}</em>:<br>  ${data.output} (Total: <strong>${data.total}</strong>) <em style="color: #aaa;">(Hidden from players)</em>`;
				} else if (!data.isHiddenByDM) {
					messageHtml = `[${time}] <strong>${data.roller}</strong> rolled <em>${data.input}</em>:<br>  ${data.output} (Total: <strong>${data.total}</strong>)`;
				} else {
					console.warn("Dice log: Unhandled display case for diceResult data:", data);
					messageHtml = `[${time}] <strong>${data.roller}</strong> rolled.`;
				}
				
				rollEntry.innerHTML = messageHtml;
				
				if (diceLogElement.firstChild) {
					diceLogElement.insertBefore(rollEntry, diceLogElement.firstChild);
				} else {
					diceLogElement.appendChild(rollEntry);
				}

				const maxLogEntries = 50;
				while (diceLogElement.children.length > maxLogEntries) {
					diceLogElement.removeChild(diceLogElement.lastChild);
				}
			}
		});

		// This listener handles clicks on the entire dice log container
		if (diceLogElement) {
			diceLogElement.addEventListener('click', (event) => {
				// This feature is DM-only
				if (currentRole !== 'dm') return;

				// Find the specific <p> element that was clicked
				const clickedEntry = event.target.closest('p[data-total]');
				if (!clickedEntry) return; // Ignore clicks on the background or on entries without a total

				if (selectedTokenIndex === -1) {
					showNotification('Please click a token to apply damage to first.', false);
					return;
				}

				const damage = parseInt(clickedEntry.dataset.total, 10);
				const dealerUsername = clickedEntry.dataset.roller; // Get the original roller's name
				const targetId = tokensData[selectedTokenIndex].id;

				// Emit the event to the server
				socket.emit('applySpecificDamage', {
					damage: damage,
					targetId: targetId,
					dealerUsername: dealerUsername
				});
			});
		}


		function updateTokenNames() {
			// Remove existing token names
			document.querySelectorAll('.token-name').forEach(el => el.remove());

			const minDistance = 40; // Minimum pixel distance between names
			const visibleNames = [];
			const occupiedPositions = new Set();

			// Determine which tokens' names should potentially be displayed
			tokensData.forEach(tokenData => {
				// Decide if this token's name should be visible to the *current client*
				let shouldDisplayName = false;
				const isOwner = tokenData.owner === username || (tokenData.isMinion && tokenData.parentOwner === username);

				if (currentRole === 'dm') {
					shouldDisplayName = true; // DM sees all names
				} else { // Player role
					if (isMapFullyVisible) { // If DM enabled All Visible
						shouldDisplayName = true; // Player sees all names if DM has 'Show Map' on
					} else { // Standard player FoW is active (visibility sets populated in drawGrid)
						// Player sees their OWN token name OR other tokens' names if knowable
						shouldDisplayName = isOwner || isTokenInBrightLight(tokenData); // Use isTokenInBrightLight here!
					}
				}

				// If the name should be displayed based on the rules above
				if (shouldDisplayName) {
					// Calculate screen position - use token center X and token top Y
					const tokenSize = tokenData.size || 1;
					const canvasX_center = (tokenData.x + tokenSize / 2) * gridSize; // Canvas X center of the token
					const canvasY_top = tokenData.y * gridSize; // Canvas Y top of the token bounding box

					const screenX_center = canvasX_center * scale + panX;
					const screenY_top = canvasY_top * scale + panY;

					// Check if this is the currently hovered or dragged token for priority
					const originalIndex = tokensData.findIndex(t => t.id === tokenData.id);
					// MODIFIED: "Important" now includes the persistently selected token
					const isImportant = originalIndex === hoveredTokenIndex || originalIndex === draggedTokenIndex || originalIndex === selectedTokenIndex;
					const priority = isImportant ? 2 : 0; // Priority 2 for important, 0 for others


					// Apply overlap check *only* if we are NOT showing all names (i.e., under standard FoW rules) AND below zoom threshold
					let canShow = true;
					// Overlap check applies if player, FoW is ON (Map Visible OFF), AND zoom is below threshold (using 1.0 as threshold)
					// This prevents name clutter in dense areas under FoW unless zoomed in
					// Also skip overlap check for important tokens (priority 2)
					if (scale < 1.0 && !isImportant) { // Corrected condition here
							for (const visible of visibleNames) {
								// Skip overlap check against other important tokens
								if (visible.priority === 2) continue;

								const dx_pixels = Math.abs(screenX_center - visible.screenX);
								const dy_pixels = Math.abs(screenY_top - visible.screenY_top);
								const distance = Math.sqrt(dx_pixels * dx_pixels + dy_pixels * dy_pixels);
								// Use minDistance scaled inversely by current zoom level
								if (distance < minDistance / scale) { // Divide minDistance by scale
									canShow = false;
									break;
								}
							}
					}

					// If allowed to show name (either by rule or passing overlap check)
					if (canShow) {
						// Add to list with calculated priority
						visibleNames.push({ tokenData, screenX: screenX_center, screenY_top: screenY_top, priority: priority });
					}
				}
			});

			// --- Sort the names before creating and appending the divs ---
			// Primary sort: Priority (higher value means higher priority, should be added later in DOM to appear on top)
			// Secondary sort: Screen Y position descending (labels for lower tokens should be added later)
			// Tertiary sort: Screen X position ascending (labels for lefter elements should be added earlier)
			visibleNames.sort((a, b) => {
				// Primary sort: Priority (hovered/dragged highest, put later in sort)
				if (b.priority !== a.priority) {
					return b.priority - a.priority; // Descending priority
				}
				// Secondary sort: Screen Y position (descending, so lower elements appear later/on top in DOM)
				if (b.screenY_top !== a.screenY_top) {
						return b.screenY_top - a.screenY_top; // Descending Y
				}
				// Tertiary sort: Screen X position (ascending, so lefter elements draw earlier/behind)
					return a.screenX - b.screenX; // Ascending X
			});


			// Create and position name divs for the visible names
			visibleNames.forEach(({ tokenData, screenX, screenY_top, priority }) => { // Include priority in destructuring
				const posKey = `${Math.round(screenX)},${Math.round(screenY_top)}`;
				const isHovered = priority === 2; // Priority 2 means it's hovered/dragged

				// If a name is already at this position, AND this token is NOT the one being hovered, skip it.
				if (occupiedPositions.has(posKey) && !isHovered) {
					return; // This is the "continue" that skips drawing the overlapping name
				}
				occupiedPositions.add(posKey);
				const nameDiv = document.createElement('div');
				nameDiv.classList.add('token-name');

				// Set text content based on role and token data
				if (currentRole === 'dm') {
					const hpDisplay = tokenData.maxHP > 0 && tokenData.hp !== undefined ? `${tokenData.hp}/${tokenData.maxHP}` : (tokenData.hp !== undefined ? tokenData.hp : '--/--');
					const initDisplay = tokenData.initiative !== undefined ? tokenData.initiative : '--';
					const acDisplay = tokenData.ac !== undefined ? tokenData.ac : '--';
					const lightDisplay = tokenData.isLightSource ? `Light: ${tokenData.brightRange || 0}/${tokenData.dimRange || 0}` : '';
					if (lightDisplay) {
						nameDiv.innerHTML = `${tokenData.name} (HP: ${hpDisplay}, Init: ${initDisplay}, AC: ${acDisplay}) <br> ${lightDisplay}`;
						nameDiv.style.lineHeight = '1.2';
					} else {
						nameDiv.textContent = `${tokenData.name} (HP: ${hpDisplay}, Init: ${initDisplay}, AC: ${acDisplay})`;
					}
				} else {
					// Players only see the basic name
					nameDiv.textContent = tokenData.name;
				}
				nameDiv.dataset.tokenId = tokenData.id;

				// Append first to measure (needed for offsetWidth/offsetHeight if calculating true center)
				document.body.appendChild(nameDiv);

				// Position the name div
				// Set left to the token's screen center X
					nameDiv.style.left = `${screenX}px`;
				// Set top to the token's screen top Y minus a small offset.
				// The CSS transform translate(-50%, -100%) will then correctly
				// position the name's bottom-center at (screenX, screenY_top - 5).
					nameDiv.style.top = `${screenY_top - 5}px`; // 5px padding above token


				// Add hovered style and set z-index
				const originalIndex = tokensData.findIndex(t => t.id === tokenData.id);
				// MODIFIED: Selection check includes persistent selection
				const isCurrentlySelected = originalIndex === hoveredTokenIndex || originalIndex === draggedTokenIndex || originalIndex === selectedTokenIndex;

				// Use priority for z-index: Higher priority tokens (selected/dragged) get higher z-index (100). Others get 10.
				nameDiv.style.zIndex = priority === 2 ? '100' : '10';


				if (isCurrentlySelected) {
					nameDiv.classList.add('hovered'); // Apply hovered style
				} else {
					// Dim non-selected names *only when FoW is active for players*
					// If DM, or Player with Show Map ON, keep opacity 1.0
					if (currentRole === 'player' && !isMapFullyVisible) {
							nameDiv.style.opacity = '0.7'; // Dim non-hovered/non-selected names under player FoW
					} else {
							nameDiv.style.opacity = '1.0'; // Full opacity when FoW is off (DM or Player + All Visible)
					}
				}
			});
		}

		function getTokenAtPosition(canvasX, canvasY) {
			// Filter tokens to only consider those that are knowable and interactable
			// Interaction requires ownership/DM role AND visibility/knowability
			const interactiveTokens = tokensData.filter(token => {
					const isOwner = token.owner === username || (token.isMinion && token.parentOwner === username);

					if (currentRole === 'dm') return true; // DM can interact with any token regardless of visibility

					// Player can only interact with owned tokens...
					if (isOwner) {
						// ...and only if they are visible on the map for the player.
						// If DM has 'Show Map' on, owned tokens are always interactive.
						if (isMapFullyVisible) return true;
						// If FOW is active ('Show Map' is off), player can only interact with owned tokens if they are knowable by their vision/light.
						return isTokenKnowable(token); // Check based on player vision/light/walls
					}

					return false; // Player cannot interact with non-owned tokens
			});


			for (let i = interactiveTokens.length - 1; i >= 0; i--) {
				const tokenData = interactiveTokens[i];
				const originalIndex = tokensData.findIndex(t => t.id === tokenData.id); // Get original index
				const tokenSize = tokenData.size || 1;
				const tokenPixelWidth = gridSize * tokenSize;
				const tokenPixelHeight = gridSize * tokenSize;
				const tokenX = tokenData.x * gridSize;
				const tokenY = tokenData.y * gridSize;

				// Simple bounding box check first
				if (
					canvasX >= tokenX &&
					canvasX < tokenX + tokenPixelWidth &&
					canvasY >= tokenY &&
					canvasY < tokenY + tokenPixelHeight
				) {
					// The filter `interactiveTokens` already ensures knowability and ownership/role for interaction
					return { token: tokenData, index: originalIndex };
				}
			}
			return null; // No interactive token found at position
		}

		// MODIFIED: handleInteractionStart now implements click-to-select
		function handleInteractionStart(clientX, clientY) {
			if (isLoading || isContextMenuOpen) return; // Prevent interaction while loading or menu is open

			const rect = canvas.getBoundingClientRect();
			const canvasX = (clientX - rect.left - panX) / scale;
			const canvasY = (clientY - rect.top - panY) / scale;

			if (currentInteractionMode === 'interact') {
				const tokenInfo = getTokenAtPosition(canvasX, canvasY);

				if (tokenInfo) {
					// A token was clicked. This is now the selected token.
					selectedTokenIndex = tokenInfo.index; // <-- NEW: Set persistent selection
					
					// Start dragging the token.
					draggedToken = tokenInfo.token;
					draggedTokenIndex = tokenInfo.index;
					offsetX = canvasX - draggedToken.x * gridSize;
					offsetY = canvasY - draggedToken.y * gridSize;
					drawGrid(); // Redraw to show selection immediately
				} else {
					// The background was clicked. Deselect any token and start panning.
					selectedTokenIndex = -1; // <-- NEW: Deselect on background click
					isPanning = true;
					startX = clientX;
					startY = clientY;
					drawGrid(); // Redraw to remove selection highlight
				}
			} else if (currentRole === 'dm' && (currentInteractionMode === 'draw' || currentInteractionMode === 'erase')) {
				// Only DM can draw/erase walls
				const gridX = Math.floor(canvasX / gridSize);
				const gridY = Math.floor(canvasY / gridSize);
				if (gridX >= 0 && gridX < currentGridWidthCells && gridY >= 0 && gridY < currentGridHeightCells) {
					// Ensure wall array is initialized for the row
					if (!walls[gridY]) walls[gridY] = Array(currentGridWidthCells).fill(0);
					// Only make a change if the state is different
					const newState = currentInteractionMode === 'draw' ? 1 : 0;
					if (walls[gridY][gridX] !== newState) {
						pendingWallChanges[`${gridY}_${gridX}`] = newState;
						walls[gridY][gridX] = newState;
						maskDirty = true; // Wall changed, need mask update
						drawGrid(); // Redraw immediately for drawing feedback
					}
						isDrawing = true; // Set drawing flag
						startX = gridX; // Store start cell for potential line drawing (though current impl is pixel by pixel)
						startY = gridY;
				}
			}
		}

						// --- Context Menu Logic ---
						// --- Context Menu Logic ---
				// --- Context Menu Logic ---
		// REPLACE your existing showContextMenu function with this one

		function showContextMenu(clientX, clientY, tokenIndex) {
			// Remove any existing context menus
			document.querySelectorAll('.token-context-menu').forEach(m => m.remove());
			isContextMenuOpen = true; // Set flag immediately to prevent other interactions

			const menu = document.createElement('div');
			menu.classList.add('token-context-menu');
			let menuX = clientX;
			let menuY = clientY;

			// Add base styles
			if (document.body.classList.contains('dark-mode')) {
				menu.style.backgroundColor = '#222';
				menu.style.border = '1px solid white';
				menu.style.color = 'white';
			} else {
				menu.style.backgroundColor = 'white';
				menu.style.border = '1px solid black';
				menu.style.color = 'black';
			}
			menu.style.padding = '8px';
			menu.style.zIndex = '1000';
			menu.style.borderRadius = '4px';
			menu.style.boxShadow = '2px 2px 8px rgba(0,0,0,0.3)';
			menu.style.display = 'flex';
			menu.style.flexDirection = 'column';
			menu.style.gap = '6px';

			const token = tokensData[tokenIndex];
			if (!token) {
				isContextMenuOpen = false;
				return;
			}

			// Build menu content based on role and token ownership
			let menuHTML = `<div style="font-weight: bold; margin-bottom: 2px; text-align: center;">${token.name}</div>`;

			// --- Add role-specific content ---
			if (currentRole === 'dm') {
				// --- MODIFICATION: Added Rename, Re-image, and separator for DM ---
				menuHTML += `
					<div style="display: flex; align-items: center; gap: 6px;">
                        <label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Name:</label>
                        <input type="text" class="name-input" value="${token.name}" style="flex-grow: 1; padding: 4px;">
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Image URL:</label>
                        <input type="text" class="image-url-input" value="${token.imageUrl || ''}" style="flex-grow: 1; padding: 4px;">
                        <button class="browse-image-button" style="padding: 4px 8px; flex-shrink: 0;">...</button>
                    </div>
                    <hr style="border: 0; border-top: 1px solid #555; margin: 4px 0;">
					<button class="remove-token" style="width: 100%; background: #ffdddd; border: 1px solid red; padding: 6px; cursor: pointer;">Remove Token</button>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Rotate:</label>
						<input type="number" class="rotate-input" value="${token.rotation || 0}" min="0" max="360" step="1" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Sight:</label>
						<input type="number" class="sight-input" value="${token.sightRadius || 0}" min="0" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Is Light Source:</label>
						<input type="checkbox" id="context-isLightSource" class="light-source-checkbox" ${token.isLightSource ? 'checked' : ''} style="flex-grow: 1;">
					</div>
					<div class="light-range-inputs" style="display: ${token.isLightSource ? 'flex' : 'none'}; flex-direction: column; gap: 6px; padding-left: 10px; border-left: 1px solid #ccc;">
						<div style="display: flex; align-items: center; gap: 6px;">
								<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Bright:</label>
								<input type="number" id="context-bright-range" class="bright-range-input" value="${token.brightRange || 0}" min="0" style="flex-grow: 1; padding: 4px;">
						</div>
						<div style="display: flex; align-items: center; gap: 6px;">
								<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Dim:</label>
								<input type="number" id="context-dim-range" class="dim-range-input" value="${token.dimRange || 0}" min="0" style="flex-grow: 1; padding: 4px;">
						</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Max HP:</label>
						<input type="number" class="max-hp-input" value="${token.maxHP || 0}" min="0" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Cur HP:</label>
						<input type="number" class="hp-input" value="${token.hp || 0}" min="0" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Init:</label>
						<input type="number" class="init-input" value="${token.initiative || 0}" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">AC:</label>
						<input type="number" class="ac-input" value="${token.ac || 0}" min="0" style="flex-grow: 1; padding: 4px;">
					</div>
				`;

			} else if (token.owner === username || (token.isMinion && token.parentOwner === username)) {
				// Player owns token - Add player-editable fields (Rotate) and viewable info
				menuHTML += `
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Rotate:</label>
						<input type="number" class="rotate-input" value="${token.rotation || 0}" min="0" max="360" step="1" style="flex-grow: 1; padding: 4px;">
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Sight:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.sightRadius || 0}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Light:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.isLightSource ? `${token.brightRange || 0}/${token.dimRange || 0}` : 'No'}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">HP:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.maxHP > 0 && token.hp !== undefined ? `${token.hp}/${token.maxHP}` : (token.hp !== undefined ? token.hp : '--/--')}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Init:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.initiative !== undefined ? token.initiative : '--'}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">AC:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.ac !== undefined ? token.ac : '--'}</div>
					</div>
				`;
			} else {
				// Player does not own token - Add read-only info
				menuHTML += `
					<div style="font-size: 0.9em; padding: 6px; text-align: center;">(You don't own this token)</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Light:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.isLightSource ? `${token.brightRange || 0}/${token.dimRange || 0}` : 'No'}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">HP:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.maxHP > 0 && token.hp !== undefined ? `${token.hp}/${token.maxHP}` : (token.hp !== undefined ? token.hp : '--/--')}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">Init:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.initiative !== undefined ? token.initiative : '--'}</div>
					</div>
					<div style="display: flex; align-items: center; gap: 6px;">
						<label style="font-size: 0.9em; flex-shrink: 0; width: 60px;">AC:</label>
						<div style="flex-grow: 1; font-size: 0.9em;">${token.ac !== undefined ? token.ac : '--'}</div>
					</div>
				`;
			}

			// --- Buttons ---
			if (currentRole === 'dm' || token.owner === username || (token.isMinion && token.parentOwner === username)) {
				menuHTML += `
					<div style="display: flex; gap: 6px; margin-top: 4px;">
						<button class="save-button" style="flex-grow: 1; background: #ddffdd; border: 1px solid green; padding: 6px; cursor: pointer;">Save</button>
						<button class="cancel-button" style="flex-grow: 1; background: #dddddd; border: 1px solid gray; padding: 6px; cursor: pointer;">Cancel</button>
					</div>
				`;
			} else {
				menuHTML += `<button class="cancel-button" style="width: 100%; background: #dddddd; border: 1px solid gray; padding: 6px; cursor: pointer; margin-top: 4px;">Close</button>`;
			}

			menu.innerHTML = menuHTML;
			document.body.appendChild(menu);

			// --- Attach Event Listeners ---
			const menuWidthActual = menu.offsetWidth;
			const menuHeightActual = menu.offsetHeight;
			if (clientX + menuWidthActual > window.innerWidth - 10) { menuX = window.innerWidth - menuWidthActual - 10; }
			if (clientY + menuHeightActual > window.innerHeight - 10) { menuY = window.innerHeight - menuHeightActual - 10; }
			menuX = Math.max(10, menuX);
			menuY = Math.max(10, menuY);
			menu.style.left = `${menuX}px`;
			menu.style.top = `${menuY}px`;

			const browseButton = menu.querySelector('.browse-image-button');
			if (browseButton) {
				browseButton.addEventListener('click', async (e) => {
					e.stopPropagation();
					if (isElectron) {
						try {
							const dataUrl = await window.electronAPI.openFile();
							if (dataUrl) {
								const imageUrlInput = menu.querySelector('.image-url-input');
								imageUrlInput.value = dataUrl;
							}
						} catch (err) {
							console.error("Error opening file dialog:", err);
							showNotification("Could not open file.", true);
						}
					} else {
						showNotification("Local file browsing is only available in the Electron app.", false);
					}
				});
			}

			const lightSourceCheckbox = menu.querySelector('#context-isLightSource');
			const lightRangeInputsDiv = menu.querySelector('.light-range-inputs');
			if (lightSourceCheckbox && lightRangeInputsDiv) {
				const brightRangeInputForListener = menu.querySelector('#context-bright-range');
				const dimRangeInputForListener = menu.querySelector('#context-dim-range');
				lightSourceCheckbox.addEventListener('change', () => {
					const isChecked = lightSourceCheckbox.checked;
					lightRangeInputsDiv.style.display = isChecked ? 'flex' : 'none';
					if (!isChecked && brightRangeInputForListener && dimRangeInputForListener) {
						brightRangeInputForListener.value = '0';
						dimRangeInputForListener.value = '0';
					}
				});
			}

			const removeButton = menu.querySelector('.remove-token');
			if (removeButton) { // This implicitly checks for DM role
				removeButton.addEventListener('click', (e) => {
					e.stopPropagation();
					if (confirm(`Are you sure you want to remove the token "${token.name}"?`)) {
						socket.emit('removeToken', token.id);
						menu.remove();
						isContextMenuOpen = false;
					}
				});
			}

			const saveButton = menu.querySelector('.save-button');
			if (saveButton) {
				saveButton.addEventListener('click', (e) => {
					e.stopPropagation();

					// Start building the update object
					const statsToUpdate = { tokenId: token.id };

					// Query all possible inputs that could exist in the menu
                    const nameInput = menu.querySelector('.name-input');
                    const imageUrlInput = menu.querySelector('.image-url-input');
					const rotateInput = menu.querySelector('.rotate-input');
					const maxHPInput = menu.querySelector('.max-hp-input');
					const hpInput = menu.querySelector('.hp-input');
					const initInput = menu.querySelector('.init-input');
					const acInput = menu.querySelector('.ac-input');
					const sightInput = menu.querySelector('.sight-input');
					const lightCheckbox = menu.querySelector('#context-isLightSource');
					const brightRangeInput = menu.querySelector('#context-bright-range');
					const dimRangeInput = menu.querySelector('#context-dim-range');

					// Add values to payload if the corresponding input exists
                    if (nameInput) statsToUpdate.name = nameInput.value.trim();
                    if (imageUrlInput) statsToUpdate.imageUrl = imageUrlInput.value.trim();
					if (rotateInput) statsToUpdate.rotation = parseInt(rotateInput.value, 10) % 360 || 0;
					if (maxHPInput) statsToUpdate.maxHP = parseInt(maxHPInput.value, 10) || 0;
					if (hpInput) statsToUpdate.hp = parseInt(hpInput.value, 10) || 0;
					if (initInput) statsToUpdate.initiative = parseInt(initInput.value, 10) || 0;
					if (acInput) statsToUpdate.ac = parseInt(acInput.value, 10) || 0;
					if (sightInput) statsToUpdate.sightRadius = parseInt(sightInput.value, 10) || 0;
					if (lightCheckbox) statsToUpdate.isLightSource = lightCheckbox.checked;
					if (brightRangeInput) statsToUpdate.brightRange = parseInt(brightRangeInput.value, 10) || 0;
					if (dimRangeInput) statsToUpdate.dimRange = parseInt(dimRangeInput.value, 10) || 0;
                    
                    // The server will handle dim >= bright logic, but we can do it here too
                    if (statsToUpdate.brightRange !== undefined && statsToUpdate.dimRange < statsToUpdate.brightRange) {
                        statsToUpdate.dimRange = statsToUpdate.brightRange;
                    }

					socket.emit('updateTokenStats', statsToUpdate);
					menu.remove();
					isContextMenuOpen = false;
				});
			}

			const cancelButton = menu.querySelector('.cancel-button');
			if (cancelButton) {
				cancelButton.addEventListener('click', (e) => {
					e.stopPropagation();
					menu.remove();
					isContextMenuOpen = false;
				});
			}

			menu.addEventListener('click', (e) => e.stopPropagation());
			menu.addEventListener('touchstart', (e) => e.stopPropagation());

			function closeMenu(event) {
				if (isContextMenuOpen && menu && !menu.contains(event.target)) {
					menu.remove();
					isContextMenuOpen = false;
					document.removeEventListener('click', closeMenu);
					document.removeEventListener('touchstart', closeMenu);
					document.removeEventListener('contextmenu', closeMenu);
				}
			}

			requestAnimationFrame(() => {
				document.addEventListener('click', closeMenu);
				document.addEventListener('touchstart', closeMenu);
				document.addEventListener('contextmenu', closeMenu);
			});
		} // End showContextMenu

		function handleLongPress(clientX, clientY) {
			if (isLoading || currentInteractionMode !== 'interact' || isContextMenuOpen) return;

			const rect = canvas.getBoundingClientRect();
			const canvasX = (clientX - rect.left - panX) / scale;
			const canvasY = (clientY - rect.top - panY) / scale;

			const tokenInfo = getTokenAtPosition(canvasX, canvasY);
			// Show context menu if a token is hit, regardless of ownership (limited options for others)
			if (tokenInfo) {
				showContextMenu(clientX, clientY, tokenInfo.index);
			}
		}

		function resetInteraction() {
			// If wall drawing was in progress, emit the changes
			if (isDrawing && Object.keys(pendingWallChanges).length > 0) {
				socket.emit('updateWalls', walls);
				pendingWallChanges = {}; // Clear pending changes after emitting
			}
			// Reset interaction states
			draggedToken = null;
			draggedTokenIndex = -1;
			isPanning = false;
			isDrawing = false; // For walls
			isLongPressing = false;
			// Clear any pending long press timer
			if (longPressTimeout) {
				clearTimeout(longPressTimeout);
				longPressTimeout = null;
			}
			// NOTE: We DO NOT reset `selectedTokenIndex` here. That only happens on a new click.
			// Flag mask as dirty because token movement or ending wall drawing might change visibility
			maskDirty = true;
			drawGrid(); // Redraw to reflect final state and clear effects (like drag)
		}

		// --- Add Token Form Submission ---
		addTokenForm.addEventListener('submit', (event) => {
			event.preventDefault();
			event.stopPropagation();

			// Get form values
			const nameValue = document.getElementById('token-name').value.trim();
			const imageValue = document.getElementById('token-image').value.trim();
			const imageFile = document.getElementById('token-image-file').files[0];
			const colorValue = document.getElementById('token-color').value.trim();
			const sizeValue = parseInt(document.getElementById('token-size').value, 10);
			const rotationValue = parseInt(document.getElementById('token-rotation').value, 10) % 360;
			// DM-only fields - check if element exists before accessing value
			const maxHPInput = document.getElementById('token-max-hp');
			const hpInput = document.getElementById('token-hp');
			const initInput = document.getElementById('token-init');
			const acInput = document.getElementById('token-ac');
			const sightRadiusInput = document.getElementById('token-sight-radius');
			const isLightSourceCheckbox = document.getElementById('isLightSource');
			const brightRangeInput = document.getElementById('token-bright-range');
			const dimRangeInput = document.getElementById('token-dim-range');


			const maxHPValue = currentRole === 'dm' && maxHPInput ? (parseInt(maxHPInput.value, 10) || 0) : 0;
			const hpValue = currentRole === 'dm' && hpInput ? (parseInt(hpInput.value, 10) || 0) : 0;
			const initValue = initInput ? (parseInt(initInput.value, 10) || 0) : 0; // Init can be set by players too? Current form says DM-only class, so treat as DM-only for submission
			const acValue = acInput ? (parseInt(acInput.value, 10) || 0) : 0;     // AC can be set by players too? Current form says DM-only class, so treat as DM-only for submission
			const sightRadiusValue = currentRole === 'dm' && sightRadiusInput ? (parseInt(sightRadiusInput.value, 10) || 0) : 0; // Sight is DM-only
			const isLightSource = currentRole === 'dm' && isLightSourceCheckbox ? isLightSourceCheckbox.checked : false; // Light is DM-only
			const brightRangeValue = currentRole === 'dm' && isLightSource && brightRangeInput ? (parseInt(brightRangeInput.value, 10) || 0) : 0; // Bright is DM-only
			const dimRangeValue = currentRole === 'dm' && isLightSource && dimRangeInput ? (parseInt(dimRangeInput.value, 10) || 0) : 0; // Dim is DM-only


			const isMinion = document.getElementById('isMinion').checked;

			function submitToken(imageUrl) {
				if (!imageUrl && !colorValue) {
					showNotification('Please provide either an image (URL or file) or a color for the token.', true);
					return;
				}

				// --- DM TOKEN SPAWN LOGIC ---
				let spawnX = Math.floor(currentGridWidthCells / 2); // Default to center
				let spawnY = Math.floor(currentGridHeightCells / 2); // Default to center

				// Look for a token specifically named "Exit" for DM tokens
				const exitToken = tokensData.find(token => token.name && token.name.toLowerCase() === 'exit');

				if (exitToken) {
					// If an Exit token exists, use its coordinates
					spawnX = exitToken.x;
					spawnY = exitToken.y;
					console.log(`"Exit" token found. Spawning DM token at [${spawnX}, ${spawnY}].`);
				} else {
					console.log(`No "Exit" token found. Spawning DM token at default center.`);
				}
				// --- END DM TOKEN SPAWN LOGIC ---

				const newTokenData = {
					name: nameValue || 'Unnamed Token', // Default name
					x: spawnX, // <--- CORRECTED: Use the calculated spawnX
					y: spawnY, // <--- CORRECTED: Use the calculated spawnY
					imageUrl: imageUrl || null,
					imageFilename: imageFile ? imageFile.name : null,
					backgroundColor: !imageUrl ? (colorValue || 'grey') : null,
					size: sizeValue || 1,
					rotation: rotationValue || 0,
					maxHP: maxHPValue,
					hp: hpValue,
					initiative: initValue,
					ac: acValue,
					sightRadius: sightRadiusValue,
					isLightSource: isLightSource,
					brightRange: brightRangeValue,
					dimRange: dimRangeValue,
					isMinion: isMinion,
					owner: username // DM is always the owner here
				};

				console.log(`Attempting to add token: ${newTokenData.name}`);

				try {
					socket.emit('addToken', newTokenData);
				} catch (err) {
					console.error('Error emitting addToken:', err);
					showNotification('Failed to add token. Please try again.', true);
				}

				// Clear the form after submission
				document.getElementById('token-name').value = '';
				document.getElementById('token-image').value = '';
				document.getElementById('token-image-file').value = '';
				document.getElementById('token-color').value = '';
				document.getElementById('token-size').value = '1';
				document.getElementById('token-rotation').value = '0';
				if (maxHPInput) maxHPInput.value = '0';
				if (hpInput) hpInput.value = '0';
				if (initInput) initInput.value = '0';
				if (acInput) acInput.value = '0';
				if (sightRadiusInput) sightRadiusInput.value = '0'; // <--- CORRECTED: Reset to 0
				if (isLightSourceCheckbox) isLightSourceCheckbox.checked = false;
				const lightRangeInputsDiv = document.querySelector('#add-token-form .light-range-inputs');
					if (lightRangeInputsDiv) lightRangeInputsDiv.style.display = 'none';
					if (brightRangeInput) document.getElementById('token-bright-range').value = '0';
					if (dimRangeInput) document.getElementById('token-dim-range').value = '0';
				document.getElementById('isMinion').checked = false;
			}

			if (imageFile) {
				imageToDataUrl(imageFile, (dataUrl) => {
					submitToken(dataUrl);
				});
			} else {
				submitToken(imageValue);
			}
		});

		// Add listener for Light Source checkbox in the DM Add Token form
		const addTokenLightSourceCheckbox = document.getElementById('isLightSource');
		const addTokenLightRangeInputsDiv = document.querySelector('#add-token-form .light-range-inputs');
		if (addTokenLightSourceCheckbox && addTokenLightRangeInputsDiv) {
			addTokenLightSourceCheckbox.addEventListener('change', () => {
				addTokenLightRangeInputsDiv.style.display = addTokenLightSourceCheckbox.checked ? 'flex' : 'none';
			});
				// Set initial display based on default checkbox state
				addTokenLightRangeInputsDiv.style.display = addTokenLightSourceCheckbox.checked ? 'flex' : 'none';
		}


		// --- Player Token Form Submission ---
		playerTokenForm.addEventListener('submit', (event) => {
			event.preventDefault();
			event.stopPropagation();

			// Get form values
			const nameValue = document.getElementById('player-token-name').value.trim();
			const imageValue = document.getElementById('player-token-image').value.trim();
			const imageFile = document.getElementById('player-token-image-file').files[0];
			const colorValue = document.getElementById('player-token-color').value.trim();
			const sizeValue = parseInt(document.getElementById('player-token-size').value, 10);
			const rotationValue = parseInt(document.getElementById('player-token-rotation').value, 10) % 360;
			const isMinion = document.getElementById('playerIsMinion').checked;

			// Player tokens have default/no values for DM-only stats/light when added
			const playerDefaultSightRadius = 30; // Define default sight radius for player tokens

			function submitPlayerToken(imageUrl) {
				if (!imageUrl && !colorValue) {
					showNotification('Please provide either an image (URL or file) or a color for the token.', true);
					return;
				}

				// --- NEW SPAWN LOGIC ---
				let spawnX = Math.floor(currentGridWidthCells / 2); // Default to center
				let spawnY = Math.floor(currentGridHeightCells / 2); // Default to center

				// Look for a token specifically named "Start"
				const startToken = tokensData.find(token => token.name && token.name.toLowerCase() === 'start');

				if (startToken) {
					// If a Start token exists, use its coordinates
					spawnX = startToken.x;
					spawnY = startToken.y;
					console.log(`"Start" token found. Spawning player at [${spawnX}, ${spawnY}].`);
				} else {
					console.log(`No "Start" token found. Spawning player at default center.`);
				}
				// --- END NEW SPAWN LOGIC ---

				const newTokenData = {
					// ID is generated on the server
					name: nameValue || `${username || 'Player'}'s Token`,
					x: spawnX, // Use the determined spawnX
					y: spawnY, // Use the determined spawnY
					imageUrl: imageUrl || null,
					imageFilename: imageFile ? imageFile.name : null,
					backgroundColor: !imageUrl ? (colorValue || 'grey') : null,
					size: sizeValue || 1,
					rotation: rotationValue || 0,
					maxHP: 0,
					hp: 0,
					initiative: 0,
					ac: 0,
					sightRadius: 0, // Player default sight
					isLightSource: false,
					brightRange: 0,
					dimRange: 0,
					isMinion: isMinion,
					owner: username
				};

				console.log(`Attempting to add player token: ${newTokenData.name}`);

				try {
					socket.emit('addToken', newTokenData);
				} catch (err) {
					console.error('Error emitting addToken:', err);
					showNotification('Failed to add token. Please try again.', true);
				}

				// Clear the form after submission
				document.getElementById('player-token-name').value = '';
				document.getElementById('player-token-image').value = '';
				document.getElementById('player-token-image-file').value = '';
				document.getElementById('player-token-color').value = '';
				document.getElementById('player-token-size').value = '1';
				document.getElementById('player-token-rotation').value = '0';
				document.getElementById('playerIsMinion').checked = false;
			}

			if (imageFile) {
				imageToDataUrl(imageFile, (dataUrl) => {
					submitPlayerToken(dataUrl);
				});
			} else {
				submitPlayerToken(imageValue);
			}
		});


		darkModeToggle.addEventListener('click', () => {
			const isDarkMode = !document.body.classList.contains('dark-mode');
			document.body.classList.toggle('dark-mode', isDarkMode);
			darkModeToggle.textContent = isDarkMode ? 'Light Mode' : 'Dark Mode';
			localStorage.setItem('darkMode', isDarkMode);
			updateDarkModeStyles(isDarkMode);
			drawGrid();
		});

		showControlsButton.addEventListener('click', () => {
			controlsWrapper.style.display = 'block';
			showControlsButton.style.display = 'none';
		});

		closeControlsButton.addEventListener('click', () => {
			controlsWrapper.style.display = 'none';
			showControlsButton.style.display = 'block';
		});

		gridSizeSelect.addEventListener('change', () => {
			const sizeKey = gridSizeSelect.value;

			// *** Player Role Check (moved earlier for clarity) ***
			if (currentRole !== 'dm') {
				showNotification("Only the DM can change the scene size.", false);
				// Revert the select value visually if player tried to change it
				// Find the current size key based on actual grid dimensions
				const currentSizeKey = Object.keys(gridSizeOptions).find(
					key => gridSizeOptions[key]?.width === currentGridWidthCells &&
							gridSizeOptions[key]?.height === currentGridHeightCells
				); // Note: If current size IS custom, this might be undefined.

				// If the player selected 'custom', or if the current size *is* custom, ensure the select reflects reality
				if (sizeKey === 'custom' || !currentSizeKey) {
						// If current size isn't a preset, or they tried to select custom, leave it as custom
						gridSizeSelect.value = 'custom';
						// Ensure custom inputs are shown and populated if the current size *is* custom
						if (customSizeInputsDiv && customWidthInput && customHeightInput) {
							customWidthInput.value = currentGridWidthCells;
							customHeightInput.value = currentGridHeightCells;
							customSizeInputsDiv.style.display = 'block';
						}
				} else {
					// If current size is a preset, revert to that preset
						gridSizeSelect.value = currentSizeKey;
						// Ensure custom inputs are hidden if reverting to a preset
						if (customSizeInputsDiv) {
							customSizeInputsDiv.style.display = 'none';
						}
				}
				return; // Stop processing for players
			}

			// *** DM Logic ***
			if (sizeKey === 'custom') {
				// DM selected 'Custom' from the dropdown
				customWidthInput.value = currentGridWidthCells; // Pre-fill with current size
				customHeightInput.value = currentGridHeightCells;
				customSizeInputsDiv.style.display = 'block'; // Show the custom input fields
				// We don't emit here; the DM needs to click "Apply Custom Size"
			} else {
				// DM selected a PRESET size from the dropdown
				customSizeInputsDiv.style.display = 'none'; // Hide the custom input fields

				// Look up the dimensions for the selected preset
				const newGridSize = gridSizeOptions[sizeKey];

				if (!newGridSize) {
						// This check catches cases where the selected value *isn't* 'custom' but also *isn't* a valid preset key
						// (e.g., if someone modified the HTML options incorrectly)
						console.error("Error: Selected preset size key not found in options:", sizeKey);
						showNotification("Error: Invalid preset size selected.", true);

						// Revert select to the *actual* current size (which might be a different preset or custom)
						const currentSizeKey = Object.keys(gridSizeOptions).find(
							key => gridSizeOptions[key]?.width === currentGridWidthCells &&
								gridSizeOptions[key]?.height === currentGridHeightCells
		);

						if (currentSizeKey) {
							gridSizeSelect.value = currentSizeKey;
							customSizeInputsDiv.style.display = 'none';
						} else {
							gridSizeSelect.value = 'custom'; // It must be a custom size already
							if (customSizeInputsDiv && customWidthInput && customHeightInput) {
								customWidthInput.value = currentGridWidthCells;
								customHeightInput.value = currentGridHeightCells;
								customSizeInputsDiv.style.display = 'block';
							}
						}
						return;
				}

				// Emit the valid preset size to the server
				socket.emit('updateGridSize', { width: newGridSize.width, height: newGridSize.height });
				showNotification(`Updating grid size to ${sizeKey} (${newGridSize.width}x${newGridSize.height})...`);
			}
		});
		
		applyCustomSizeButton.addEventListener('click', () => {
			if (currentRole !== 'dm') {
				showNotification("Only the DM can apply custom scene sizes.", false);
				return;
			}

			const widthValue = customWidthInput.value;
			const heightValue = customHeightInput.value;

			const customWidth = parseInt(widthValue, 10);
			const customHeight = parseInt(heightValue, 10);

			// Basic validation (matches input attributes)
			const minSize = 5;
			const maxSize = 500; // Match your input max attribute

			if (isNaN(customWidth) || isNaN(customHeight) ||
				customWidth < minSize || customWidth > maxSize ||
				customHeight < minSize || customHeight > maxSize) {
				showNotification(`Invalid custom size. Width and Height must be numbers between ${minSize} and ${maxSize}.`, true);
				return;
			}

			// Send the custom grid size update to the server
			socket.emit('updateGridSize', { width: customWidth, height: customHeight });
			showNotification(`Updating grid size to custom dimensions (${customWidth}x${customHeight})...`);

			// Optional: Hide the custom inputs again after applying
			// customSizeInputsDiv.style.display = 'none';
		});


		// --- Interaction Mode Buttons ---
		function setInteractionMode(mode) {
			currentInteractionMode = mode;
			// Reset button styles
			interactButton.style.backgroundColor = '';
			drawWallButton.style.backgroundColor = '';
			eraseWallButton.style.backgroundColor = '';

			// Set active button style
			if (mode === 'interact') {
				interactButton.style.backgroundColor = '#5bc0de';
			} else if (mode === 'draw') {
				drawWallButton.style.backgroundColor = '#5bc0de';
			} else if (mode === 'erase') {
				eraseWallButton.style.backgroundColor = '#5bc0de';
			}
			// No need to drawGrid immediately, will happen on next mouse/touch event
		}

		interactButton.addEventListener('click', () => setInteractionMode('interact'));
		drawWallButton.addEventListener('click', () => {
			if (currentRole !== 'dm') {
					showNotification("Only the DM can draw walls.", false);
					return;
			}
			setInteractionMode('draw');
		});
		eraseWallButton.addEventListener('click', () => {
				if (currentRole !== 'dm') {
					showNotification("Only the DM can erase walls.", false);
					return;
			}
			setInteractionMode('erase');
		});

		// Set initial mode style
		setInteractionMode(currentInteractionMode);


		toggleGridButton.addEventListener('click', () => {
			if (currentRole === 'dm') {
				socket.emit('updateGridVisibility', !isGridVisible);
			} else {
					showNotification("Only the DM can toggle the grid lines.", false);
			}
		});
		
		if (toggleAllVisibleButton) { // Ensure the button element was found
				console.log("Attaching click listener to toggleAllVisibleButton."); // DEBUG LOG: Is listener being attached?
				toggleAllVisibleButton.addEventListener('click', () => {
					console.log("Toggle All Visible button click event fired!"); // DEBUG LOG 1
					console.log("Current role inside listener:", currentRole); // DEBUG LOG 2

					// Only allow the DM to click this button
					if (currentRole === 'dm') {
						console.log("User is DM. Proceeding with toggle logic."); // DEBUG LOG 3
						const newState = !isMapFullyVisible;
						console.log("Emitting 'toggleMapVisibility' with newState:", newState); // DEBUG LOG 4

						// Emit the toggle state to the server
						socket.emit('toggleMapVisibility', newState);
						// Provide immediate feedback to the DM client (this will be updated again by the server broadcast)
						showNotification(isMapFullyVisible ? 'Turning off "All Visible" map.' : 'Turning on "All Visible" map.');
						// The server will broadcast the official state back, which updates the local state and button text
					} else {
						console.log("User is not DM. Blocking toggle."); // DEBUG LOG 5
						showNotification("Only the DM can toggle the 'All Visible' map feature.", false);
					}
				});
		} else {
			console.warn("toggleAllVisibleButton element not found. Event listener not attached."); // DEBUG LOG: Button not found
		}
		
		resetViewButton.addEventListener('click', () => {
			scale = 1;
			// Center the grid in the canvas
			panX = (canvas.width - currentGridWidthCells * gridSize * scale) / 2;
			panY = (canvas.height - currentGridHeightCells * gridSize * scale) / 2;
			drawGrid();
		});

		backgroundForm.addEventListener('submit', (event) => event.preventDefault()); // Prevent default form submit

		loadBackgroundButton.addEventListener('click', () => {
			if (currentRole !== 'dm') {
					showNotification("Only the DM can change the background.", false);
					return;
			}
			const url = backgroundImageUrlInput.value.trim();
			if (url) {
				socket.emit('updateBackground', url);
				showNotification('Sending background URL to server...');
			} else {
					showNotification("Please enter a background image URL.", false);
			}
		});

		clearBackgroundButton.addEventListener('click', () => {
				if (currentRole !== 'dm') {
					showNotification("Only the DM can clear the background.", false);
					return;
			}
			socket.emit('updateBackground', '');
			showNotification('Clearing background...');
		});

		backgroundImageFileInput.addEventListener('change', () => {
				if (currentRole !== 'dm') {
					showNotification("Only the DM can upload a background.", false);
					return;
			}
			const file = backgroundImageFileInput.files[0];
			if (file) {
				imageToDataUrl(file, (dataUrl) => {
					if (dataUrl) {
						socket.emit('updateBackground', dataUrl);
						showNotification('Uploading background image...');
					} else {
						showNotification("Failed to read background image file.", true);
					}
				});
				backgroundImageFileInput.value = ''; // Clear file input
			}
		});

		saveStateButton.addEventListener('click', () => {
				if (currentRole !== 'dm') {
					showNotification("Only the DM can save the state.", false);
					return;
			}
			socket.emit('saveState');
			// Notification handled by server 'saveSuccess' event
		});

		downloadStateButton.addEventListener('click', async () => { // Make it async
			if (currentRole !== 'dm') {
				showNotification("Only the DM can download the state.", false);
				return;
			}

			// --- NEW EXPORT LOGIC ---
			const zip = new JSZip();
			const imagesFolder = zip.folder("images"); // Create an "images" folder in the zip
			let imageCounter = 0;
			const processedTokens = [];

			// 1. Process Tokens: Extract images, replace with paths
			for (const token of tokensData) {
				let tokenImagePath = null;
				if (token.imageUrl && token.imageUrl.startsWith('data:image')) {
					// It's a Base64 image
					try {
						const MimeType = token.imageUrl.substring(token.imageUrl.indexOf(':')+1,token.imageUrl.indexOf(';')); // image/png or image/jpeg
						const fileExtension = MimeType.split('/')[1] || 'png'; // Default to png
						const imageName = `token_${token.id || imageCounter++}.${fileExtension}`;

						// Get Base64 data part
						const base64Data = token.imageUrl.split(',')[1];
						await imagesFolder.file(imageName, base64Data, { base64: true });
						tokenImagePath = `images/${imageName}`; // Path within the zip
						console.log(`Added ${imageName} to zip from token ${token.name}`);
					} catch (error) {
						console.error(`Error processing image for token ${token.name}:`, error);
						showNotification(`Error saving image for token ${token.name}. It might be skipped.`, true);
						// Keep original imageUrl if saving fails, or set to null
						tokenImagePath = token.imageUrl; // Or null if you prefer to mark it as failed
					}
				} else if (token.imageUrl) {
					// It's a URL, keep it as is for now.
					// Future enhancement: download and embed these too, or warn user.
					tokenImagePath = token.imageUrl;
				}

				processedTokens.push({
					id: token.id,
					name: token.name,
					x: token.x,
					y: token.y,
					// Store the path OR the original URL if it wasn't Base64
					imageUrl: tokenImagePath,
					// imageFilename: token.imageFilename, // Redundant if we name by ID/counter
					backgroundColor: token.backgroundColor,
					size: token.size,
					rotation: token.rotation,
					maxHP: token.maxHP,
					hp: token.hp,
					initiative: token.initiative,
					ac: token.ac,
					sightRadius: token.sightRadius,
					isLightSource: token.isLightSource,
					brightRange: token.brightRange,
					dimRange: token.dimRange,
					isMinion: token.isMinion,
					owner: token.owner,
					parentOwner: token.parentOwner
					// imageObj is a runtime object, don't save
				});
			}

			// 2. Process Background Image
			let processedBackgroundImageUrl = backgroundImageUrl;
			if (backgroundImageUrl && backgroundImageUrl.startsWith('data:image')) {
				try {
					const MimeType = backgroundImageUrl.substring(backgroundImageUrl.indexOf(':')+1,backgroundImageUrl.indexOf(';'));
					const fileExtension = MimeType.split('/')[1] || 'png';
					const bgImageName = `background.${fileExtension}`;
					const base64Data = backgroundImageUrl.split(',')[1];
					await imagesFolder.file(bgImageName, base64Data, { base64: true });
					processedBackgroundImageUrl = `images/${bgImageName}`; // Path within the zip
					console.log(`Added ${bgImageName} to zip.`);
				} catch (error) {
					console.error('Error processing background image:', error);
					showNotification('Error saving background image. It might be skipped.', true);
					// Keep original if saving fails
				}
			}

			// 3. Create the main state JSON
			const state = {
				tokens: processedTokens, // Use the processed tokens
				walls: normalizeWalls(walls, currentGridWidthCells, currentGridHeightCells),
				isGridVisible: isGridVisible,
				isMapFullyVisible: isMapFullyVisible,
				backgroundImageUrl: processedBackgroundImageUrl, // Use the processed URL/path
				gridSize: { width: currentGridWidthCells, height: currentGridHeightCells },
				version: "1.0-zip" // Add a version for your new format
			};

			zip.file("session_data.json", JSON.stringify(state, null, 2));

			// 4. Generate and Download ZIP
			try {
				const content = await zip.generateAsync({ type: "blob" });
				const url = URL.createObjectURL(content);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'thorgrid-session.zip'; // New extension
				document.body.appendChild(a); // Required for Firefox
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
				showNotification('Session exported as ZIP.');
			} catch (error) {
				console.error("Error generating ZIP:", error);
				showNotification("Failed to generate ZIP export.", true);
			}
		});

		importStateButton.addEventListener('click', () => {
			if (currentRole !== 'dm') {
					showNotification("Only the DM can import the state.", false);
					return;
			}
			importStateFile.click();
		});

		importStateFile.addEventListener('change', async () => { // Make it async
			const file = importStateFile.files[0];
			if (file) {
				isLoading = true; // Set loading flag

				if (file.name.endsWith(".zip")) {
					// --- CORRECTED ZIP IMPORT LOGIC ---
					try {
						const zip = await JSZip.loadAsync(file);
						const sessionFile = zip.file("session_data.json");
						if (!sessionFile) throw new Error('session_data.json not found in zip.');

						const jsonString = await sessionFile.async("string");
						const state = JSON.parse(jsonString);
						if (!state || !state.tokens) throw new Error('Invalid session_data.json format.');

						// Process all image paths into data URLs BEFORE emitting
						const imageLoadPromises = [];

						const processImage = async (path) => {
							const imageFileInZip = zip.file(path);
							if (!imageFileInZip) {
								console.warn(`Image ${path} not found in zip.`);
								return null;
							}
							const base64Data = await imageFileInZip.async("base64");
							const fileExtension = path.split('.').pop().toLowerCase();
							let mimeType = 'image/png';
							if (fileExtension === 'jpg' || fileExtension === 'jpeg') mimeType = 'image/jpeg';
							else if (fileExtension === 'gif') mimeType = 'image/gif';
							else if (fileExtension === 'webp') mimeType = 'image/webp';
							return `data:${mimeType};base64,${base64Data}`;
						};
						
						state.tokens.forEach(token => {
							if (token.imageUrl && token.imageUrl.startsWith('images/')) {
								const promise = processImage(token.imageUrl).then(dataUrl => {
									token.imageUrl = dataUrl;
								});
								imageLoadPromises.push(promise);
							}
						});

						if (state.backgroundImageUrl && state.backgroundImageUrl.startsWith('images/')) {
							const promise = processImage(state.backgroundImageUrl).then(dataUrl => {
								state.backgroundImageUrl = dataUrl;
							});
							imageLoadPromises.push(promise);
						}

						// Wait for all images to be converted to data URLs
						await Promise.all(imageLoadPromises);
						
						// Now emit the fully processed state to the server
						socket.emit('importState', state);
						showNotification('Importing session from ZIP...');

					} catch (err) {
						console.error('Failed to process ZIP file:', err);
						showNotification('Failed to import session from ZIP. Invalid or corrupted file.', true);
						isLoading = false;
					} finally {
						importStateFile.value = '';
					}

				} else if (file.name.endsWith(".json")) {
					// --- ORIGINAL JSON IMPORT LOGIC (for backward compatibility) ---
					const reader = new FileReader();
					reader.onload = (e) => {
						try {
							const state = JSON.parse(e.target.result);
							if (state && Array.isArray(state.tokens) && state.gridSize) { // Basic check
								// Potentially add a version check here if you want to differentiate old JSONs
								socket.emit('importState', state);
								showNotification('Importing state from JSON...');
							} else {
								showNotification('Invalid state file format (JSON).', true);
								isLoading = false;
							}
						} catch (err) {
							console.error('Failed to parse imported JSON state:', err);
							showNotification('Failed to import state. Invalid JSON.', true);
							isLoading = false;
						} finally {
							importStateFile.value = '';
							// isLoading reset by fullStateUpdate or error
						}
					};
					reader.onerror = () => {
						console.error('Failed to read JSON file:', file.name);
						showNotification('Failed to read JSON file.', true);
						isLoading = false;
						importStateFile.value = '';
					};
					reader.readAsText(file);
				} else {
					showNotification('Unsupported file type. Please select a .zip or .json file.', true);
					isLoading = false;
					importStateFile.value = '';
				}
			} else {
				isLoading = false; // No file selected
			}
		});

		canvas.addEventListener('mousedown', (event) => {
			// Only process if not loading and not in context menu
			if (isLoading || isContextMenuOpen) return;

			if (event.button === 0) { // Left click
				handleInteractionStart(event.clientX, event.clientY);
			}
		});

		canvas.addEventListener('mousemove', (event) => {
			const rect = canvas.getBoundingClientRect();
			const canvasX = (event.clientX - rect.left - panX) / scale;
			const canvasY = (event.clientY - rect.top - panY) / scale;

			// --- Handle token dragging ---
			if (draggedToken) {
				const tokenSize = draggedToken.size || 1;
				// Calculate the potential new grid position based on mouse position and initial offset
				const newX = Math.floor((canvasX - offsetX) / gridSize);
				const newY = Math.floor((canvasY - offsetY) / gridSize);
				const maxX = currentGridWidthCells - tokenSize;
				const maxY = currentGridHeightCells - tokenSize;

				// Clamp the *intended* final position to grid bounds FIRST
				const clampedX = Math.max(0, Math.min(newX, maxX));
				const clampedY = Math.max(0, Math.min(newY, maxY));

				// --- Implement Single-Step Collision Check ---
				// Only perform this logic if the intended clamped position is DIFFERENT from the token's current cell
				if (draggedToken.x !== clampedX || draggedToken.y !== clampedY) {

					const currentX = draggedToken.x;
					const currentY = draggedToken.y;

					// Calculate the proposed next step: move one cell towards the clamped destination
					// Math.sign gives -1, 0, or 1
					let targetX = currentX + Math.sign(clampedX - currentX);
					let targetY = currentY + Math.sign(clampedY - currentY);

					// Re-clamp this single step to ensure it's still within bounds (should be, but safe)
					targetX = Math.max(0, Math.min(targetX, maxX));
					targetY = Math.max(0, Math.min(targetY, maxY));

					// Now check for collision at this *single step* target cell
					if (!isCollision(targetX, targetY, draggedToken, walls, currentGridWidthCells, currentGridHeightCells)) {
						// If there is NO collision at the single step target:
						// Update the token's local position to this new single step cell
						draggedToken.x = targetX;
						draggedToken.y = targetY;
						// console.log(`Mouse moving token ${draggedToken.name} to x: ${draggedToken.x}, y: ${draggedToken.y}`); // COMMENTED OUT
						// Emit the updated position to the server (the server will also validate)
						socket.emit('moveToken', {
							tokenId: draggedToken.id,
							x: draggedToken.x,
							y: draggedToken.y,
							rotation: draggedToken.rotation
						});
						maskDirty = true; // Token moved, need to recalculate mask (for FoW)
						drawGrid(); // Redraw immediately for smooth drag feedback
					} else {
						// If there IS a collision at the single step target:
						// The token's position is NOT updated. It stays in its last valid cell.
						// This prevents moving into the wall, even if the mouse jumps over it.
						console.log(`Collision detected for ${draggedToken.name} at [${targetX}, ${targetY}]. Blocking move.`);
						// Optional: Add visual feedback here (e.g., temporary red tint)
					}
				}
				// If the intended clamped position is the same as current, do nothing (token didn't move cells).

			// --- Handle panning ---
			} else if (isPanning) { // Handle panning if no token is dragged
				panX += event.clientX - startX;
				panY += event.clientY - startY;
				startX = event.clientX;
				startY = event.clientY;
				drawGrid();

			// --- Handle wall drawing/erasing ---
			} else if (isDrawing && currentRole === 'dm' && (currentInteractionMode === 'draw' || currentInteractionMode === 'erase')) { // Only draw/erase if in correct mode and DM
				const gridX = Math.floor(canvasX / gridSize);
				const gridY = Math.floor(canvasY / gridSize);
				// Check if the mouse is within grid bounds
				if (gridX >= 0 && gridX < currentGridWidthCells && gridY >= 0 && gridY < currentGridHeightCells) {
					// Ensure wall array is initialized for the row if it doesn't exist
					if (!walls[gridY]) walls[gridY] = Array(currentGridWidthCells).fill(0);
					// Determine the new state (1 for draw, 0 for erase)
					const newState = currentInteractionMode === 'draw' ? 1 : 0;
					// Only make a change if the wall state is different at this cell
					if (walls[gridY][gridX] !== newState) {
						// Record the change (for pending emit on mouseup/touchend)
						pendingWallChanges[`${gridY}_${gridX}`] = newState;
						// Update the local wall state immediately for visual feedback
						walls[gridY][gridX] = newState;
						maskDirty = true; // Wall changed, need mask update for FoW
						drawGrid(); // Redraw immediately
					}
				}
			} else {
				// --- Handle Hover ---
				// Handle hover for token name visibility (if no drag, pan, or draw active)
				const tokenInfo = getTokenAtPosition(canvasX, canvasY);
				const newHoveredIndex = tokenInfo ? tokenInfo.index : -1;
				// Only redraw if the hovered state changed
				if (newHoveredIndex !== hoveredTokenIndex) {
					hoveredTokenIndex = newHoveredIndex;
					drawGrid(); // Redraw to update hovered name style/z-index
				}
			}
		}); // End of mousemove listener

		canvas.addEventListener('mouseup', () => {
			resetInteraction(); // Emits wall changes if drawing
		});

		canvas.addEventListener('mouseleave', () => {
			// Only reset if not currently dragging or panning (e.g., cursor leaves during interaction)
			// If dragging/panning, the touchend/mouseup will handle the final reset.
			// This specifically handles the case where the mouse leaves the canvas area.
			if (!draggedToken && !isPanning && !isDrawing && !isLongPressing && !isContextMenuOpen) {
				resetInteraction(); // Ensures drawing/panning stops cleanly
			}
			hoveredTokenIndex = -1; // Clear hover state
			// Only redraw if the hovered state actually changed
			if (hoveredTokenIndex !== -1) drawGrid(); // Redraw to remove hover effect/name
		});

		canvas.addEventListener('touchstart', (event) => {
			event.preventDefault();
			if (isLoading || isContextMenuOpen) { // Prevent interaction while loading or menu is open
					if (longPressTimeout) clearTimeout(longPressTimeout); // Clear any accidental timeout
					isLongPressing = false;
					return;
			}

			if (event.touches.length === 1) {
				const touch = event.touches[0];
				handleInteractionStart(touch.clientX, touch.clientY);
				longPressStartX = touch.clientX;
				longPressStartY = touch.clientY;
				// Start timer for long press context menu
				// Only start if no token was immediately selected for drag (check `draggedToken`)
				// This avoids showing the context menu immediately on drag start.
				if (!draggedToken && currentInteractionMode === 'interact') {
					longPressTimeout = setTimeout(() => {
						isLongPressing = true;
						// Check if finger hasn't moved too much - This check is better in touchmove/touchend
						// Let the timeout just set the flag and call the menu handler
						handleLongPress(longPressStartX, longPressStartY);

					}, 500); // 500ms for long press
				} else {
						// If a token was selected for drag immediately, it's not a long press intent
						if (longPressTimeout) clearTimeout(longPressTimeout);
						isLongPressing = false;
				}
			} else if (event.touches.length === 2) {
				// Handle pinch-to-zoom
				resetInteraction(); // Stop any dragging/drawing first
				if (longPressTimeout) clearTimeout(longPressTimeout);
				isLongPressing = false; // Cancel long press

				const touch1 = event.touches[0];
				const touch2 = event.touches[1];
				pinchStartDistance = Math.hypot(
					touch1.clientX - touch2.clientX,
					touch1.clientY - touch2.clientY
				);
				pinchStartScale = scale;
				pinchStartCenterX = (touch1.clientX + touch2.clientX) / 2;
				pinchStartCenterY = (touch1.clientY + touch2.clientY) / 2;
			} else {
					// More than 2 touches, ignore or reset
					resetInteraction();
					if (longPressTimeout) clearTimeout(longPressTimeout);
					isLongPressing = false;
			}
		});

						canvas.addEventListener('touchmove', (event) => {
			event.preventDefault();
			if (isLoading || isContextMenuOpen) return;

			// If finger moves significantly during potential long press, cancel it
			if (longPressTimeout && event.touches.length === 1) {
					const touch = event.touches[0];
					const dx = touch.clientX - longPressStartX;
					const dy = event.changedTouches[0].clientY - longPressStartY;
					const distance = Math.sqrt(dx*dx + dy*dy);
					if (distance > 10) {
						clearTimeout(longPressTimeout);
						longPressTimeout = null;
						isLongPressing = false;
						// If dragging hadn't started yet but we moved, re-evaluate interaction start at the original touch position
						// to see if a token was under the initial touch and start dragging if so.
						if (!draggedToken && !isPanning && !isDrawing) {
							const rect = canvas.getBoundingClientRect();
							handleInteractionStart(longPressStartX, longPressStartY);
						}
					}
			}

			const rect = canvas.getBoundingClientRect();
			// Check for a single touch (used for drag, pan, or draw)
			if (event.touches.length === 1) {
				const touch = event.touches[0];
				const canvasX = (touch.clientX - rect.left - panX) / scale;
				const canvasY = (touch.clientY - rect.top - panY) / scale;

				// --- Handle token dragging ---
				if (draggedToken) {
					// Calculate the potential new grid position based on touch position and initial offset
					const tokenSize = draggedToken.size || 1;
					const newX = Math.floor((canvasX - offsetX) / gridSize);
					const newY = Math.floor((canvasY - offsetY) / gridSize);
					const maxX = currentGridWidthCells - tokenSize;
					const maxY = currentGridHeightCells - tokenSize;

					// Clamp the *intended* final position to grid bounds FIRST
					const clampedX = Math.max(0, Math.min(newX, maxX));
					const clampedY = Math.max(0, Math.min(newY, maxY));

					// --- Implement Single-Step Collision Check ---
					// Only perform this logic if the intended clamped position is DIFFERENT from the token's current cell
					if (draggedToken.x !== clampedX || draggedToken.y !== clampedY) {

						const currentX = draggedToken.x;
						const currentY = draggedToken.y;

						// Calculate the proposed next step: move one cell towards the clamped destination
						// Math.sign gives -1, 0, or 1
						let targetX = currentX + Math.sign(clampedX - currentX);
						let targetY = currentY + Math.sign(clampedY - currentY);

						// Re-clamp this single step to ensure it's still within bounds (should be, but safe)
						targetX = Math.max(0, Math.min(targetX, maxX));
						targetY = Math.max(0, Math.min(targetY, maxY));

						// Now check for collision at this *single step* target cell
						if (!isCollision(targetX, targetY, draggedToken, walls, currentGridWidthCells, currentGridHeightCells)) {
							// If there is NO collision at the single step target:
							// Update the token's local position to this new single step cell
							draggedToken.x = targetX;
							draggedToken.y = targetY;
							// console.log(`Touch moving token ${draggedToken.name} to x: ${draggedToken.x}, y: ${draggedToken.y}`); // COMMENTED OUT
							// Emit the updated position to the server (the server will also validate)
							socket.emit('moveToken', {
								tokenId: draggedToken.id,
								x: draggedToken.x,
								y: draggedToken.y,
								rotation: draggedToken.rotation
							});
							maskDirty = true; // Token moved, need to recalculate mask (for FoW)
							drawGrid(); // Redraw immediately for smooth drag feedback
						} else {
							// If there IS a collision at the single step target:
							// The token's position is NOT updated. It stays in its last valid cell.
							// This prevents moving into the wall, even if the touch jumps over it.
							console.log(`Collision detected for ${draggedToken.name} at [${targetX}, ${targetY}]. Blocking move.`);
							// Optional: Add visual feedback here (e.g., temporary red tint)
						}
					}
					// If the intended clamped position is the same as current, do nothing (token didn't move cells).

				// --- Handle panning ---
				} else if (isPanning && !isLongPressing) { // Handle panning if no token is dragged and not a potential long press
					panX += touch.clientX - startX;
					panY += touch.clientY - startY;
					startX = touch.clientX;
					startY = touch.clientY;
					drawGrid();

				// --- Handle wall drawing/erasing ---
				} else if (isDrawing && currentRole === 'dm' && (currentInteractionMode === 'draw' || currentInteractionMode === 'erase')) { // Only draw/erase if in correct mode and DM
					const gridX = Math.floor(canvasX / gridSize);
					const gridY = Math.floor(canvasY / gridSize);
					// Check if the touch is within grid bounds
					if (gridX >= 0 && gridX < currentGridWidthCells && gridY >= 0 && gridY < currentGridHeightCells) {
						// Ensure wall array is initialized for the row if it doesn't exist
						if (!walls[gridY]) walls[gridY] = Array(currentGridWidthCells).fill(0);
						// Determine the new state (1 for draw, 0 for erase)
						const newState = currentInteractionMode === 'draw' ? 1 : 0;
						// Only make a change if the wall state is different at this cell
						if (walls[gridY][gridX] !== newState) {
							// Record the change (for pending emit on touchend)
							pendingWallChanges[`${gridY}_${gridX}`] = newState;
							// Update the local wall state immediately for visual feedback
							walls[gridY][gridX] = newState;
							maskDirty = true; // Wall changed, need mask update for FoW
							drawGrid(); // Redraw immediately
						}
					}
				}
			// --- Handle Pinch-to-Zoom ---
			} else if (event.touches.length === 2) { // Handle two touches for pinch-to-zoom
				// Ensure any pending single-touch interactions are reset
				resetInteraction();
				if (longPressTimeout) clearTimeout(longPressTimeout);
				isLongPressing = false;

				// Pinch-to-zoom logic
				const touch1 = event.touches[0];
				const touch2 = event.touches[1];
				// Calculate distance between touches
				const newDistance = Math.hypot(
					touch1.clientX - touch2.clientX,
					touch1.clientY - touch2.clientY
				);
				// Calculate the center point of the pinch
				const newCenterX = (touch1.clientX + touch2.clientX) / 2;
				const newCenterY = (touch1.clientY + touch2.clientY) / 2;

				// Calculate the zoom factor based on the change in pinch distance
				const scaleFactor = newDistance / pinchStartDistance;
				// Apply the zoom factor to the previous scale, clamping between min/max
				const newScale = pinchStartScale * scaleFactor;
				scale = Math.max(0.2, Math.min(newScale, 5)); // Clamp scale between 0.2x and 5x

				// Adjust pan to keep the pinch center point (in world coordinates) stable on the screen
				const rect = canvas.getBoundingClientRect(); // Recalculate rect just in case (might change during pinch)
				// Calculate the canvas coordinates of the initial pinch center in the *old* scale
				const canvasCenterX = (pinchStartCenterX - rect.left - panX) / pinchStartScale;
				const canvasCenterY = (pinchStartCenterY - rect.top - panY) / pinchStartScale;
				// Calculate the new pan offset needed to keep that canvas point under the new pinch center
				panX = newCenterX - rect.left - canvasCenterX * scale;
				panY = newCenterY - rect.top - canvasCenterY * scale;

				// Update pinch start values for the next touchmove event
				pinchStartDistance = newDistance;
				pinchStartScale = scale;
				pinchStartCenterX = newCenterX;
				pinchStartCenterY = newCenterY;

				drawGrid(); // Redraw after zoom/pan
			}
			// If more than 2 touches, we ignore them (handled by initial check in touchstart)
		}); // End of touchmove listener

		canvas.addEventListener('touchend', (event) => {
				// If a long press timer was active, clear it and check if it was a tap vs long press
			if (longPressTimeout) {
					clearTimeout(longPressTimeout);
					longPressTimeout = null;
					// If it was a short tap (not a drag or long press), handle interaction start/click
					// Check if touch ended *without* significant movement and was not flagged as long press
					const dx = event.changedTouches[0].clientX - longPressStartX;
					const dy = event.changedTouches[0].clientY - longPressStartY;
					const distance = Math.sqrt(dx*dx + dy*dy);
					// If interaction didn't turn into a drag/pan AND distance is small, treat as a click/tap
					if (!draggedToken && !isPanning && !isDrawing && distance < 10 && !isLongPressing) {
					// Simulate a click interaction at the start position
						handleInteractionStart(longPressStartX, longPressStartY); // This will either start drag (if it wasn't picked up before) or do nothing if no token/pan/draw
						resetInteraction(); // Then reset immediately as it was just a tap
					}
					isLongPressing = false; // Reset flag
			}

			// Reset general interaction state *only* if all touches are lifted
			if (event.touches.length === 0) {
				resetInteraction(); // Emits wall changes if drawing
			}
		});

		canvas.addEventListener('touchcancel', () => {
			resetInteraction();
				if (longPressTimeout) {
					clearTimeout(longPressTimeout);
					longPressTimeout = null;
					isLongPressing = false;
			}
		});

		canvas.addEventListener('wheel', (event) => {
			event.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const mouseX = event.clientX - rect.left;
			const mouseY = event.clientY - rect.top;

			const zoomSpeed = 0.0005; // Slower zoom speed
			// Use exponential scaling for smoother zoom levels
			const zoomFactor = Math.exp(-event.deltaY * zoomSpeed);

			const canvasX = (mouseX - panX) / scale;
			const canvasY = (mouseY - panY) / scale;

			const newScale = scale * zoomFactor;
			scale = Math.max(0.2, Math.min(newScale, 5)); // Clamp scale between 0.2x and 5x

			// Adjust pan to zoom into the mouse position
			panX = mouseX - canvasX * scale;
			panY = mouseY - canvasY * scale;

			drawGrid();
		});

		window.addEventListener('resize', resizeCanvas);
		
		if (clearBoardButtonElement && socket) { // Make sure to check for socket
			clearBoardButtonElement.addEventListener('click', () => {
				if (currentRole === 'dm') {
					const warningMessage = "DANGER ZONE!\n\n" +
											"You are about to CLEAR EVERYTHING on the current map:\n" +
											"- All Tokens\n" +
											"- All Walls\n" +
											"- The Background Image\n\n" +
											"This action CANNOT BE UNDONE from the application.\n" +
											"Are you absolutely, 100% sure you want to proceed?";
					if (confirm(warningMessage)) {
						socket.emit('clearBoard');
						
						// Optional: Client-side view reset
						// scale = 1;
						// panX = (canvas.width - currentGridWidthCells * gridSize * scale) / 2;
						// panY = (canvas.height - currentGridHeightCells * gridSize * scale) / 2;
						// drawGrid(); 
					}
				} else {
					showNotification("This action is DM-only.", true);
				}
			});
		}

		// Login handler
		document.getElementById('loginButton').addEventListener('click', () => {
			username = document.getElementById('usernameInput').value.trim();
			currentRole = document.getElementById('roleSelect').value;
			if (!username) {
				showNotification('Please enter a username.', true);
				return;
			}
			if (!socket || !socket.connected) {
				showNotification('Not connected to server. Cannot login.', true);
				return;
			}
			console.log(`Attempting login as ${username} (${currentRole})`);
			socket.emit('login', { username, role: currentRole });
		});

			socket.on('roleAssigned', ({ role, username: assignedUsername }) => {
			console.log(`Role assigned by server: ${role}, Username: ${assignedUsername}`);
			currentRole = role;
			username = assignedUsername;
			document.getElementById('loginScreen').classList.add('hidden');
			document.body.classList.add(`role-${currentRole}`);
			updateDarkModeStyles(document.body.classList.contains('dark-mode'));
			showNotification(`Logged in as ${username} (${role})`);

			// The server address display logic is handled in determineServerUrl
			// based on whether it's running in Electron or a browser.
			// It doesn't need to be re-run here on role assignment.
			// If you wanted to dynamically update it (e.g., if IP changes mid-session, unlikely)
			// you'd need a server event for that.
			// For now, remove the redundant display update from here.

			// Recalculate visibility for the new role
			maskDirty = true;
			resizeCanvas();
		});

		// Initial state load
		socket.on('init', (data) => {
			isLoading = true; // Prevent interaction while loading
			console.log("Initial state received:", data); // Added log to see received data structure

			// Map tokens, ensuring correct structure and applying defaults for new properties
			// Correctly ensure numeric/boolean types here using Number() and Boolean()
			tokensData = (data.tokens || []).map(token => ({
				...token, // Keep existing properties
				// Ensure numeric positions and add default visibility/light properties if missing
				x: Number.isFinite(token.x) ? Number(token.x) : Math.floor((data.gridSize?.width || gridSizeOptions.small.width) / 2),
				y: Number.isFinite(token.y) ? Number(token.y) : Math.floor((data.gridSize?.height || gridSizeOptions.small.height) / 2),
				sightRadius: Number.isFinite(token.sightRadius) ? Number(token.sightRadius) : 0, // Ensure numeric exists
				isLightSource: Boolean(token.isLightSource), // Ensure boolean exists
				brightRange: Number.isFinite(token.brightRange) ? Number(token.brightRange) : 0, // Ensure numeric exists
				dimRange: Number.isFinite(token.dimRange) ? Number(token.dimRange) : 0,         // Ensure numeric exists
				// Ensure other potential missing defaults from older formats
				maxHP: token.maxHP !== undefined ? Number(token.maxHP) : 0, // Ensure numeric
				hp: token.hp !== undefined ? Number(token.hp) : 0,           // Ensure numeric
				initiative: token.initiative !== undefined ? Number(token.initiative) : 0, // Ensure numeric
				ac: token.ac !== undefined ? Number(token.ac) : 0,             // Ensure numeric
				rotation: token.rotation !== undefined ? Number(token.rotation) : 0,   // Ensure numeric
				isMinion: token.isMinion !== undefined ? Boolean(token.isMinion) : false, // Ensure boolean
				owner: token.owner || null,
				parentOwner: token.parentOwner || null,
					// Ensure token size is valid
				size: Number.isFinite(token.size) && token.size > 0 ? Number(token.size) : 1, // Ensure numeric
				// imageUrl/backgroundColor/imageFilename should also be handled if needed for merging
				imageUrl: token.imageUrl || null,
				backgroundColor: token.backgroundColor || null,
				imageFilename: token.imageFilename || null,
			}));
			console.log('Initialized tokens:', tokensData.map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y, owner: t.owner, sight: t.sightRadius, light: t.isLightSource ? `${t.brightRange}/${t.dimRange}` : 'No' })));


			currentGridWidthCells = data.gridSize?.width || gridSizeOptions.small.width;
			currentGridHeightCells = data.gridSize?.height || gridSizeOptions.small.height;
			walls = normalizeWalls(data.walls, currentGridWidthCells, currentGridHeightCells);

			// View state from state file is currently ignored on init, relying on client's default or reset view.
			// If you wanted to load view state:
			// scale = data.viewState?.scale || 1;
			// panX = data.viewState?.panX || 0;
			// panY = data.viewState?.panY || 0;
			// Centering logic handled by resizeCanvas after initial load

			// --- Corrected: These state updates must be *after* the tokensData and grid size are loaded ---
			isGridVisible = data.isGridVisible !== undefined ? Boolean(data.isGridVisible) : true; // Ensure boolean
			isMapFullyVisible = data.isMapFullyVisible !== undefined ? Boolean(data.isMapFullyVisible) : false; // NEW: Init map visibility toggle state (Ensure boolean)

			// Set grid size select value based on loaded size
			const loadedSizeKey = Object.keys(gridSizeOptions).find(
				key => gridSizeOptions[key].width === currentGridWidthCells &&
						gridSizeOptions[key].height === currentGridHeightCells
			) || 'small'; // Default to 'small' if loaded size doesn't match a preset
			gridSizeSelect.value = loadedSizeKey;

			// --- ADDED: Update button text and class based on loaded state (DM only) ---
			// This runs after init, the role will be set shortly after by roleAssigned
			// It's okay to set these here, they will be corrected if needed in roleAssigned or subsequent updates.
			// Best practice is often to put this in roleAssigned after init has populated state, but this works too.
				if (currentRole === 'dm') { // Check if user is DM before touching DM-only buttons
				if (toggleGridButton) { // Check if button element exists
					toggleGridButton.textContent = isGridVisible ? 'Hide Grid' : 'Show Grid';
					toggleGridButton.classList.toggle('feature-active', !isGridVisible); // Active when grid is HIDDEN
				}
				if (toggleAllVisibleButton) { // Check if button element exists
					toggleAllVisibleButton.textContent = isMapFullyVisible ? 'Hide Map' : 'Show Map';
					toggleAllVisibleButton.classList.toggle('feature-active', isMapFullyVisible); // Active when map is FULLY VISIBLE
				}
				}
			// --- END ADDED ---


			tokensData.forEach(preloadTokenImage); // Preload images asynchronously
			loadBackgroundImage(data.backgroundImageUrl || ''); // Load background asynchronously

			maskDirty = true; // State initialized, need to calculate and build mask
			
			isLoading = false; // Loading is complete
		});

		// Listen for full state updates (used by importState on the server)
		socket.on('fullStateUpdate', (state) => {
				isLoading = true; // Prevent interaction while updating
				console.log("Full state update received:", state); // Added log

				// Map tokens, ensuring correct structure and applying defaults for new properties
				tokensData = (state.tokens || []).map(token => ({
					...token, // Keep existing properties
					// Ensure numeric positions and add default visibility/light properties if missing
					x: Number.isFinite(token.x) ? Number(token.x) : Math.floor((state.gridSize?.width || gridSizeOptions.small.width) / 2),
					y: Number.isFinite(token.y) ? Number(token.y) : Math.floor((state.gridSize?.height || gridSizeOptions.small.height) / 2),
					sightRadius: Number.isFinite(token.sightRadius) ? Number(token.sightRadius) : 0, // Ensure numeric exists
					isLightSource: Boolean(token.isLightSource), // Ensure boolean exists
					brightRange: Number.isFinite(token.brightRange) ? Number(token.brightRange) : 0, // Ensure numeric exists
					dimRange: Number.isFinite(token.dimRange) ? Number(token.dimRange) : 0,         // Ensure numeric exists
					// Include other potential missing defaults from older formats
					maxHP: token.maxHP !== undefined ? Number(token.maxHP) : 0, // Ensure numeric
					hp: token.hp !== undefined ? Number(token.hp) : 0,           // Ensure numeric
					initiative: token.initiative !== undefined ? Number(token.initiative) : 0, // Ensure numeric
					ac: token.ac !== undefined ? Number(token.ac) : 0,             // Ensure numeric
					rotation: token.rotation !== undefined ? Number(token.rotation) : 0,   // Ensure numeric
					isMinion: token.isMinion !== undefined ? Boolean(token.isMinion) : false, // Ensure boolean
					owner: token.owner || null,
					parentOwner: token.parentOwner || null,
					// Ensure token size is valid
					size: Number.isFinite(token.size) && token.size > 0 ? Number(token.size) : 1, // Ensure numeric
					// imageUrl/backgroundColor/imageFilename should also be handled if needed for merging
					imageUrl: token.imageUrl || null,
					backgroundColor: token.backgroundColor || null,
					imageFilename: token.imageFilename || null,

				}));
				// console.log('Full state update tokens processed:', tokensData.map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y, owner: t.owner, sight: t.sightRadius, light: t.isLightSource ? `${t.brightRange}/${t.dimRange}` : 'No' })));


				currentGridWidthCells = state.gridSize?.width || gridSizeOptions.small.width;
				currentGridHeightCells = state.gridSize?.height || gridSizeOptions.small.height;
				walls = normalizeWalls(state.walls, currentGridWidthCells, currentGridHeightCells);
				backgroundImageUrl = state.backgroundImageUrl || '';

				// Load view state if present (from import)
				scale = state.viewState?.scale || 1;
				panX = state.viewState?.panX || 0;
				panY = state.viewState?.panY || 0;

				// --- Corrected: These state updates must be *after* the tokensData and grid size are loaded ---
				isGridVisible = state.isGridVisible !== undefined ? Boolean(state.isGridVisible) : true; // Ensure boolean
				isMapFullyVisible = state.isMapFullyVisible !== undefined ? Boolean(state.isMapFullyVisible) : false; // NEW: Update map visibility state (Ensure boolean)


				const loadedSizeKey = Object.keys(gridSizeOptions).find(
					key => gridSizeOptions[key].width === currentGridWidthCells &&
						gridSizeOptions[key].height === currentGridHeightCells
				) || 'small';
				gridSizeSelect.value = loadedSizeKey;

				// --- ADDED: Update button text and class based on loaded state (DM only) ---
				// This runs after a full state import/update. The role should already be set.
				if (currentRole === 'dm') { // Check if user is DM before touching DM-only buttons
					if (toggleGridButton) { // Check if button element exists
					toggleGridButton.textContent = isGridVisible ? 'Hide Grid' : 'Show Grid';
					toggleGridButton.classList.toggle('feature-active', !isGridVisible); // Active when grid is HIDDEN
					}
					if (toggleAllVisibleButton) { // Check if button element exists
					toggleAllVisibleButton.textContent = isMapFullyVisible ? 'Hide Map' : 'Show Map';
					toggleAllVisibleButton.classList.toggle('feature-active', isMapFullyVisible); // Active when map is FULLY VISIBLE
					}
				}
				// --- END ADDED ---


				tokensData.forEach(preloadTokenImage); // Preload images for all tokens
				loadBackgroundImage(backgroundImageUrl);

				maskDirty = true; // State updated, need to calculate and build mask
				resizeCanvas(); // Ensure canvas size and mask canvas size are set, calls drawGrid
				// drawGrid is called recursively
				console.log("Full state update received and processed.");
				isLoading = false; // Finished loading/processing
		});


		socket.on('damageApplied', (data) => {
			generateAndPlayHitSound();
			if (diceLogElement) {
				const entry = document.createElement('p');
				const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				let messageHtml = "";

				// Determine if "You" should be displayed
				const dealerName = data.dealer === username ? "You" : `<strong>${data.dealer}</strong>`;
				const targetName = `<strong>${data.targetName}</strong>`;

				if (data.forDM && currentRole === 'dm') {
					// DM's detailed view
					const rollText = data.rollNotation ? ` ${data.rollNotation}` : '';
					messageHtml = `[${time}] ${targetName} takes <strong>${data.damage}</strong> damage from ${dealerName}${rollText}. (HP: ${data.newHP}/${data.maxHP})`;
				} else if (!data.forDM) {
					// Player's public view
					const rollText = data.rollNotation ? ` ${data.rollNotation}` : '';
					messageHtml = `[${time}] ${targetName} takes <strong>${data.damage}</strong> damage from ${dealerName}${rollText}.`;
				}

				// Only add the entry if a message was generated (protects players from seeing DM-only events)
				if (messageHtml) {
					entry.innerHTML = messageHtml;
					if (diceLogElement.firstChild) {
						diceLogElement.insertBefore(entry, diceLogElement.firstChild);
					} else {
						diceLogElement.appendChild(entry);
					}
				}
			}
		});

socket.on('updateTokens', (tokens) => {
			// Merge updates, but intelligently discard the old image object if the URL changes.
			tokensData = tokens.map(updatedToken => {
				const existingToken = tokensData.find(t => t.id === updatedToken.id);
				
				let imageObjToKeep = null;

				// If we have an old token to compare against...
				if (existingToken) {
					// AND the image URL is the same as the old one, AND we have a loaded image...
					if (existingToken.imageUrl === updatedToken.imageUrl && existingToken.imageObj) {
						// ...then we can keep the pre-loaded image object to save bandwidth.
						imageObjToKeep = existingToken.imageObj;
					}
					// Otherwise, imageObjToKeep remains null, forcing a reload of the new image.
				}

				// The rest of your normalization logic is good, let's keep it.
				const x = Number.isFinite(updatedToken.x) ? updatedToken.x : existingToken?.x || 0;
				const y = Number.isFinite(updatedToken.y) ? updatedToken.y : existingToken?.y || 0;
                
				return {
					...updatedToken, // Use the new data from server as the base
					x, y, // Apply normalized coordinates
					imageObj: imageObjToKeep // Use the intelligently determined image object
				};
			});

			// Handle removed tokens (this part is fine)
			tokensData = tokensData.filter(token => tokens.some(t => t.id === token.id));

			// Re-check indices (this part is fine)
			if (draggedToken && !tokensData.some(t => t.id === draggedToken.id)) {
				draggedToken = null; draggedTokenIndex = -1;
			}
			if (hoveredTokenIndex !== -1 && !tokensData[hoveredTokenIndex]) {
				hoveredTokenIndex = -1;
			}
			if (selectedTokenIndex !== -1 && !tokensData[selectedTokenIndex]) {
				selectedTokenIndex = -1;
			}

			// NOW this loop will correctly find tokens with a new URL,
			// because their imageObj was set to null during the merge.
			tokensData.forEach(token => {
				if (!token.imageObj && token.imageUrl) {
					preloadTokenImage(token);
				}
			});

			maskDirty = true;
			drawGrid();
		});

		// Server emits updateWalls. Client receives and updates local walls.
		socket.on('updateWalls', (newWalls) => {
			// updateGridSize also sends updateWalls, which will trigger fullStateUpdate anyway.
			// This handler is mainly for continuous drawing/erasing.
			// Fog of War requires mask update whenever walls change.
			walls = normalizeWalls(newWalls, currentGridWidthCells, currentGridHeightCells);
			maskDirty = true; // Walls changed, need mask update
			drawGrid(); // Redraw the grid
		});

		socket.on('updateGridVisibility', (newIsGridVisible) => {
			isGridVisible = newIsGridVisible;
			if (currentRole === 'dm' && toggleGridButton) {
				toggleGridButton.textContent = isGridVisible ? 'Hide Grid' : 'Show Grid';
				toggleGridButton.classList.toggle('feature-active', !isGridVisible); // Active when grid is HIDDEN
			}
			maskDirty = true; // Grid visibility changed, need mask update
			drawGrid();
		});
		
		// Socket Listener: Handle map visibility toggle state updates
		socket.on('mapVisibilityToggled', (newState) => {
			isMapFullyVisible = Boolean(newState); // Ensure the state is a boolean
			console.log(`Map visibility toggle state received: ${isMapFullyVisible}`);

			// --- ADDED: Update button text and class ---
			// We check for `currentRole === 'dm'` here because only DMs see the button
			if (currentRole === 'dm' && toggleAllVisibleButton) { // Added the check back
				toggleAllVisibleButton.textContent = isMapFullyVisible ? 'Hide Map' : 'Show Map';
				toggleAllVisibleButton.classList.toggle('feature-active', isMapFullyVisible); // Active when map is FULLY VISIBLE
			}
			// --- END ADDED ---
			// Flag the mask as dirty because the visibility state has changed, requiring a rebuild/clear
			maskDirty = true;
			drawGrid(); // Request a redraw to apply the visibility state
		});

		socket.on('updateBackground', (url) => {
			loadBackgroundImage(url); // loadBackgroundImage already calls drawGrid
		});

		socket.on('updateGridSize', (gridSize) => {
			currentGridWidthCells = gridSize.width;
			currentGridHeightCells = gridSize.height;

			// Try to find a matching preset key
			const loadedSizeKey = Object.keys(gridSizeOptions).find(
				key => gridSizeOptions[key].width === currentGridWidthCells &&
						gridSizeOptions[key].height === currentGridHeightCells
			);

			if (loadedSizeKey) {
				// If it matches a preset, select that preset and hide custom inputs
				gridSizeSelect.value = loadedSizeKey;
				if (customSizeInputsDiv) { // Check if element exists
						customSizeInputsDiv.style.display = 'none';
				}
			} else {
				// If it doesn't match a preset, select "Custom" and show/update inputs
				gridSizeSelect.value = 'custom';
				if (customSizeInputsDiv && customWidthInput && customHeightInput) { // Check elements exist
					customWidthInput.value = currentGridWidthCells;
					customHeightInput.value = currentGridHeightCells;
					customSizeInputsDiv.style.display = 'block'; // Or 'flex'
				}
			}

			// --- Important: Keep the rest of the original handler ---
			maskDirty = true; // Grid size changed, need mask update
			resizeCanvas();   // Updates canvas size AND mask canvas size, calls drawGrid
		});


		socket.on('error', (message) => {
			showNotification(message, true);
			// If username is in use, force the login screen back open
			if (message === 'Username already in use') {
				document.getElementById('loginScreen').classList.remove('hidden');
				// Reset role and username on client if login failed due to name conflict
				currentRole = null;
				username = null;
				document.body.className = ''; // Remove role class
					// Re-enable login button if it was disabled during connection attempts
					document.getElementById('loginButton').disabled = false;
					document.getElementById('loginButton').textContent = 'Join';
			}
		});

		socket.on('saveSuccess', (message) => {
			showNotification(message);
		});

		socket.on('clients', (clientUsernames) => { // Server now sends usernames
			// console.log('Connected clients:', clientUsernames); // Keep console cleaner
		});
	canvas.addEventListener('contextmenu', (event) => {
			event.preventDefault(); // Always prevent default right-click menu
			
			// --- UNIFIED CONTEXT MENU LOGIC ---
			// We will just trigger the same logic as a long press.
			// This keeps behavior consistent and uses your powerful, dynamic menu builder.
			if (isLoading || isContextMenuOpen || currentInteractionMode !== 'interact') return;
			
			// Call the same handler that a long-press touch event would.
			handleLongPress(event.clientX, event.clientY);
		});	

	} // End initializeSocket

	// Start the process by determining the server URL and then initializing the socket
	determineServerUrl();	

}); // End DOMContentLoaded listener