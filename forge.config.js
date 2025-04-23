module.exports = {
  packagerConfig: {
    icon: './build/icon', // Base path for icons (.ico, .icns, .png)
    name: 'ThorGrid',
    appBundleId: 'com.thorgrid.vtt',
    overwrite: true
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ThorGrid',
        iconUrl: 'https://raw.githubusercontent.com/Thor-Grid/ThorGridVTT/refs/heads/main/thorgrid.ico',
        setupIcon: './build/icon.ico'
      }
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        icon: './build/icon.icns',
        format: 'ULFO'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './build/icon.png'
        }
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: './build/icon.png'
        }
      }
    }
  ]
};