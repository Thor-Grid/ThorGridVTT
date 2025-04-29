module.exports = {
  packagerConfig: {
    icon: './build/icon',
    name: 'thor-grid', // <--- CHANGE THIS BACK to 'thor-grid' (matches package.json.name)
    executableName: 'thor-grid', // Keep this as 'thor-grid' (matches internal name, worked before)
    appBundleId: 'com.thorgrid.vtt', // Keep this
    overwrite: true
    // productName is not needed in packagerConfig if it's in package.json, it will use that.
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
		loadingGif: './build/thor-gridvtt.gif',
        name: 'thor-grid',
        productName: 'ThorGrid VTT', // Display in Programs & Features (Keep this display name)
        setupDisplayName: 'ThorGrid VTT', // Display in Start Menu (Keep this display name)
        iconUrl: 'https://raw.githubusercontent.com/Thor-Grid/ThorGridVTT/refs/heads/main/thorgrid.ico', // Keep
        setupIcon: './build/icon.ico', // Keep
        // loadingGif: './build/icon.gif', // ENSURE THIS IS COMMENTED/REMOVED if you removed the GIF
      }
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        icon: './build/icon.icns', // Keep
        format: 'ULFO' // Keep
        // productName: 'ThorGrid VTT' // Optional DMG display name
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'] // Keep
      // productName: 'ThorGrid VTT' // Optional ZIP display name
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './build/icon.png', // Keep
          name: 'thor-grid', // <--- CHANGE THIS BACK to 'thor-grid' (Deb package name, fixes install dir)
          productName: 'ThorGrid VTT', // Display in Linux menu (Keep this display name)
          genericName: 'Virtual Tabletop', // Keep
          description: 'A simple, cross-platform virtual tabletop application for TTRPGs.', // Keep
          categories: ['Game', 'Utility', 'Graphics'], // Keep
          startupWMClass: 'thor-grid', // Use the internal name for window grouping
        }
      }
    }
  ]
};