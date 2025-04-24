// c:\thorgrid-electron\main.js

// Check for squirrel events first.
// If this returns true, the module handles squirrel events and exits the app gracefully.
// No further main process logic needs to run in this case.
if (require('electron-squirrel-startup')) return;

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs'); // Need fs to ensure directory exists
const config = require('./src/config'); // Use the actual config

// Note: server and loadState are now imported AFTER app is ready, or passed path
let serverModule; // Delay requiring until path is known
let mainWindow;

// --- Function to get Local IP (Keep your existing function) ---
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            // Prefer private LAN addresses
            if ('IPv4' !== iface.family || iface.internal !== false) {
                continue;
            }
            // Prioritize common LAN ranges, adjust if your network differs
            if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                 return iface.address;
            }
            // Check for 172.16.0.0 to 172.31.255.255 range
            if (iface.address.startsWith('172.')) {
                 const parts = iface.address.split('.');
                 const secondOctet = parseInt(parts[1], 10);
                 if (secondOctet >= 16 && secondOctet <= 31) {
                    return iface.address;
                 }
            }
        }
    }
	// Fallback if no preferred LAN IP found
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
             if ('IPv4' !== iface.family || iface.internal !== false) {
                continue;
            }
            return iface.address; // Return the first non-internal IPv4
        }
    }
    return '127.0.0.1'; // More specific fallback than 'localhost'
}

const hostIp = getLocalIp(); // Determine IP early
const serverPort = config.port;
const serverUrl = `http://localhost:${serverPort}`; // Electron window always loads localhost
const lanServerAddress = `http://${hostIp}:${serverPort}`;

function createWindow(userDataPath) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            // --- Security Best Practices ---
            nodeIntegration: false, // Disable Node.js integration in renderer
            contextIsolation: true, // Keep main and renderer contexts separate
            preload: path.join(__dirname, 'preload.js') // Use a preload script
        },
        icon: path.join(__dirname, 'build', 'icon.png') // Optional: Set window icon explicitly
    });

    console.log(`Electron: Loading ${serverUrl}`);
    mainWindow.loadURL(serverUrl).catch((err) => {
        console.error('Electron: Failed to load URL:', err);
        // Fallback to loading the file directly if server fails badly
        // Note: This won't have the server backend running in this case.
        mainWindow.loadFile(path.join(__dirname, 'src', 'public', 'multitg.html'));
    });

    // Open DevTools - remove for production builds
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Make sure the userData directory exists before trying to save state there
function ensureUserDataDir(userDataPath) {
    try {
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
            console.log(`Created user data directory: ${userDataPath}`);
        }
    } catch (err) {
        console.error(`Error ensuring user data directory (${userDataPath}) exists:`, err);
        // Handle critical error - perhaps exit the app?
        app.quit();
    }
}

// --- App Lifecycle ---

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Attempt graceful shutdown
        if (serverModule && serverModule.io) {
            serverModule.io.close();
            console.log('Electron: Socket.IO closed');
        }
        if (serverModule && serverModule.server) {
            serverModule.server.close(() => {
                console.log('Electron: Server closed');
                app.quit();
            });
            // Force quit after a timeout if server doesn't close
            setTimeout(() => {
                console.warn('Electron: Server close timed out, forcing quit.');
                app.quit();
            }, 3000);
        } else {
            app.quit();
        }
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
        // Need userDataPath here too if re-creating
        const userDataPath = app.getPath('userData');
        createWindow(userDataPath);
    }
});

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
    const userDataPath = app.getPath('userData');
    console.log(`Electron: User data path: ${userDataPath}`);
    ensureUserDataDir(userDataPath);

    // Pass the correct path to the server module *before* loading state or starting
    process.env.USER_DATA_PATH = userDataPath; // Use environment variable
    serverModule = require('./src/server'); // Now require the server

    try {
        await serverModule.loadState(); // Load state using the path logic within server.js

        // IPC Handler to provide server address to renderer
        ipcMain.handle('get-server-address', async (event) => {
            return { local: serverUrl, lan: lanServerAddress };
        });

        // Start the server
        serverModule.server.listen(serverPort, '0.0.0.0', () => {
            console.log(`Electron: Server started. Access locally at ${serverUrl}`);
            console.log(`Electron: Access on your network at ${lanServerAddress}`);
            console.log(`(Ensure firewall allows connections on port ${serverPort})`);
            createWindow(userDataPath); // Pass path for consistency if needed later
        }).on('error', (err) => {
            console.error('Electron: Server failed to start:', err);
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${serverPort} is already in use. Close other instances or change the port in config.js.`);
                // Optionally show an error dialog to the user
            }
            app.quit();
        });

    } catch (err) {
        console.error('Electron: Failed during initialization (loading state or setting up IPC):', err);
        app.quit();
    }
});

// Handle potential unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});