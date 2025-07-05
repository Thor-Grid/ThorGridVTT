// c:\thorgrid-electron\main.js

// Check for squirrel events first.
// If this returns true, the module handles squirrel events and exits the app gracefully.
// No further main process logic needs to run in this case.
if (require('electron-squirrel-startup')) return;

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs'); // Need fs to ensure directory exists
const config = require('./src/config'); // Use the actual config

// Note: server and loadState are now imported AFTER app is ready, or passed path
let serverModule; // Delay requiring until path is known
let mainWindow;

// --- Function to get a preferred Local IPv4 IP ---
// Prioritizes 192.168.1.x, then other common LAN ranges, then any non-internal IPv4, then localhost.
function getPreferredLocalIp() {
    const interfaces = os.networkInterfaces();
    const allIps = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if ('IPv4' !== iface.family || iface.internal !== false) {
                continue;
            }
            allIps.push(iface.address); // Collect all non-internal IPs
        }
    }

    // Prioritize explicitly 192.168.1.x range
    const preferredIp = allIps.find(ip => ip.startsWith('192.168.1.'));
    if (preferredIp) return preferredIp;

    // Next priority: Other common LAN ranges
    const secondaryPreferredIp = allIps.find(ip => ip.startsWith('192.168.') || ip.startsWith('10.') || (ip.startsWith('172.') && parseInt(ip.split('.')[1], 10) >= 16 && parseInt(ip.split('.')[1], 10) <= 31));
    if (secondaryPreferredIp) return secondaryPreferredIp;

    // Fallback to any non-internal IPv4 if no preferred ranges found
    if (allIps.length > 0) return allIps[0];

    return '127.0.0.1'; // Final fallback
}

// --- Function to get ALL non-internal Local IPv4 IPs (for listing) ---
function getAllNonLocalIps() {
     const interfaces = os.networkInterfaces();
     const nonLocalIps = [];
     for (const name of Object.keys(interfaces)) {
         for (const iface of interfaces[name]) {
              if ('IPv4' !== iface.family || iface.internal !== false) {
                 continue;
             }
             nonLocalIps.push(iface.address);
         }
     }
     return nonLocalIps;
}


// --- Define Server Addresses ---
const serverPort = config.port; // Correct single declaration
const serverUrl = `http://localhost:${serverPort}`; // Address for the Electron window (always localhost)
const primaryLanIp = getPreferredLocalIp(); // Get the primary LAN IP using prioritization
const primaryLanAddress = `http://${primaryLanIp}:${serverPort}`; // The preferred address for other devices
const allNonLocalIps = getAllNonLocalIps(); // Get list of all non-internal IPs
// List of all possible LAN addresses (for display/info)
const allPossibleLanAddresses = allNonLocalIps.map(ip => `http://${ip}:${serverPort}`);


// Log addresses on server startup (useful for DM)
console.log(`Electron: Server configured for port ${serverPort}`);
console.log(`Electron: Localhost address: ${serverUrl}`);
console.log(`Electron: Primary LAN address: ${primaryLanAddress}`); // Log the primary one
if (allPossibleLanAddresses.length > 0) {
    console.log('Electron: All available non-local IPs:');
    allNonLocalIps.forEach(ip => console.log(`  - ${ip}`)); // Log just IPs for clarity
} else {
    console.warn('Electron: No non-internal IPv4 addresses found for LAN connections.');
}


function createWindow(userDataPath) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'build', 'icon.png')
    });

    console.log(`Electron: Loading ${serverUrl}`);
    mainWindow.loadURL(serverUrl).catch((err) => {
        console.error('Electron: Failed to load URL:', err);
        // Fallback to loading the file directly if server fails badly
        mainWindow.loadFile(path.join(__dirname, 'src', 'public', 'multitg.html'));
    });

    // mainWindow.webContents.openDevTools(); // Keep/remove as needed

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
        app.quit();
    }
}

// --- App Lifecycle ---

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (serverModule && serverModule.io) {
            serverModule.io.close();
            console.log('Electron: Socket.IO closed');
        }
        if (serverModule && serverModule.server) {
            serverModule.server.close(() => {
                console.log('Electron: Server closed');
                app.quit();
            });
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
    if (BrowserWindow.getAllWindows().length === 0) {
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

        // IPC Handler to provide server address information to renderer
			ipcMain.handle('get-server-address', async (event) => {
				return {
					local: serverUrl, // http://localhost:port
					primaryLan: primaryLanAddress, // The single preferred LAN address
					allLan: allPossibleLanAddresses // Array of all non-internal addresses (for info)
				};
			});
			ipcMain.handle('dialog:open-file', async () => {
				const { canceled, filePaths } = await dialog.showOpenDialog({
					properties: ['openFile'],
					filters: [
						{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
					]
				});
				if (canceled || filePaths.length === 0) {
					return null; // User cancelled the dialog
				}
				try {
					const filePath = filePaths[0];
					const data = await fs.promises.readFile(filePath);
					const base64 = data.toString('base64');
					const extension = path.extname(filePath).substring(1).toLowerCase();
					let mimeType = 'image/jpeg'; // Default
					if (extension === 'png') mimeType = 'image/png';
					if (extension === 'gif') mimeType = 'image/gif';
					if (extension === 'webp') mimeType = 'image/webp';
					
					return `data:${mimeType};base64,${base64}`;
				} catch (err) {
					console.error("Failed to read the selected file:", err);
					return null;
				}
			});


        // Start the server
        serverModule.server.listen(serverPort, '0.0.0.0', () => { // Listen on 0.0.0.0 to accept connections from any IP
            console.log(`Electron: Server started on port ${serverPort}`);
            console.log(`Electron: Access Electron app via: ${serverUrl}`);
            console.log(`Electron: Share this address for LAN connections: ${primaryLanAddress}`);
            if (allPossibleLanAddresses.length > 1) {
                 console.log(`Electron: Other potential LAN addresses:`);
                 allPossibleLanAddresses.filter(addr => addr !== primaryLanAddress).forEach(addr => console.log(`  - ${addr}`));
            }

            createWindow(userDataPath); // Pass path for consistency if needed later

        }).on('error', (err) => {
            console.error('Electron: Server failed to start:', err);
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${serverPort} is already in use. Close other instances or change the port in config.js.`);
                 // Optionally show an error dialog to the user here in the main process
            }
            app.quit(); // Exit if server fails to start
        });

    } catch (err) {
        console.error('Electron: Failed during initialization (loading state or setting up IPC):', err);
        app.quit(); // Exit on initialization failure
    }
});

// Handle potential unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});