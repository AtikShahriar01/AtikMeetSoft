module.exports = {
  packagerConfig: {
    name: 'AtikMeet',
    executableName: 'AtikMeet',
    icon: './assets/icon',
    asar: true,
    appVersion: '1.1.0',
    protocols: [
      {
        name: 'AtikMeet Deep Link Protocol',
        schemes: ['atikmeet']
      }
    ],
    appCopyright: 'Copyright © 2026 Atik Shahriar',
    win32metadata: {
      CompanyName: 'Atik Shahriar',
      FileDescription: 'AtikMeet - Professional Video Conferencing',
      ProductName: 'AtikMeet',
      InternalName: 'atikmeet'
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'AtikMeet',
        authors: 'Atik Shahriar',
        description: 'AtikMeet - Professional Video Conferencing Desktop App',
        iconUrl: 'https://raw.githubusercontent.com/electron/electron/main/default_app/icon.png',
        setupIcon: './assets/icon.ico'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ]
};
