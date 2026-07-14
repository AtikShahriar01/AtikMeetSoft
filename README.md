<p align="center">
  <img src="assets/icon.png" alt="AtikMeet Logo" width="130" height="130">
</p>

<h1 align="center">🌐 AtikMeet</h1>

<p align="center">
  <strong>Next-Gen Self-Hosted Video Conferencing Desktop & Background Signaling Server</strong><br>
  <em>Secure Peer-to-Peer communications, high-definition screen sharing, live recording, and robust administration panel.</em>
</p>

<p align="center">
  <a href="https://github.com/AtikShahriar01/AtikMeetSoft/releases/latest">
    <img src="https://img.shields.io/badge/Release-v1.0.1-blue.svg?style=for-the-badge" alt="Latest Release">
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node.js-v18%2B-green.svg?style=for-the-badge&logo=node.js" alt="Node Version">
  </a>
  <a href="https://www.electronjs.org/">
    <img src="https://img.shields.io/badge/Electron-v28-blueviolet.svg?style=for-the-badge&logo=electron" alt="Electron Version">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Security-P2P%20Encrypted-success?style=flat-square" alt="Security">
  <img src="https://img.shields.io/badge/Lobby%20System-Active-important?style=flat-square" alt="Lobby">
  <img src="https://img.shields.io/badge/Screen%20Share-1080p-blue?style=flat-square" alt="Screen Share">
  <img src="https://img.shields.io/badge/Platform-Windows-green?style=flat-square" alt="Platform">
</p>

---

## 📖 Table of Contents
*   [🌟 Why Choose AtikMeet?](#-why-choose-atikmeet)
*   [🚀 Core & Advanced Features](#-core--advanced-features)
*   [📊 AtikMeet vs Zoom vs Google Meet](#-atikmeet-vs-zoom-vs-google-meet)
*   [📥 Quick Installation & Run](#-quick-installation--run)
*   [🛡️ Admin panel & Security](#-admin-panel--security)
*   [💾 Standalone Server Setup](#-standalone-server-setup)
*   [📧 Contact & Support](#-contact--support)

---

## 🌟 Why Choose AtikMeet?

AtikMeet provides a zero-compromise video communication experience. By combining **WebRTC peer-to-peer data channels** with the robust capabilities of an **Electron native wrapper**, it enables secure, fast, and completely free meetings. 

Unlike public calling applications, AtikMeet allows you to host private signaling servers and manage participant licensing, giving you full control over who joins and how data flows.

---

## 🚀 Core & Advanced Features

### 🖥️ Desktop Application Experience
*   **Frameless Premium UI:** Modern, immersive dark-themed user interface with personalized title bars and window management controls.
*   **Hardware Acceleration Enabled:** Enhanced performance using GPU rasterization and zero-copy rendering modes to prevent system lag.
*   **Browser Fallback:** Guests don't need the desktop app; they can connect directly from standard mobile/desktop browsers.

### ⚙️ Advanced RTC & Signaling Engine
<details>
<summary><b>🔍 Expand: Peer-to-Peer & WebRTC Constraints</b></summary>
<br>

*   **P2P Encryption:** Media packets (audio/video) flow directly between clients, minimizing latency and server load.
*   **STUN/TURN Connectivity:** Configured with Google Stun servers for NAT traversal, ensuring successful connection handshakes across different network configurations.
*   **Dummy Frame Injection:** If a user doesn't have a webcam, the application injects a dynamic canvas-based placeholder track at 30FPS, keeping video feeds active and preventing screen share disruptions.
</details>

### 🛡️ Meeting Management & Moderation
<details>
<summary><b>🔍 Expand: Lobby, Moderation & Admin Control</b></summary>
<br>

*   **Lobby/Waiting Room:** All non-host participants wait in the secure lobby. The host receives real-time join alerts and can selectively click **Admit** or **Deny**.
*   **System Maintenance Toggle:** The administrator can set the system to maintenance mode, preventing standard users from logging in or hosting calls.
*   **User Ban & Role Management:** Ban abusive users or toggle administrator roles in real-time directly from the admin dashboard.
</details>

### 🔑 Security & Licensing System
<details>
<summary><b>🔍 Expand: License Activation Engine</b></summary>
<br>

*   **Trial Period Check:** Automatically verifies 7-day trial periods based on installation timestamps.
*   **Unique License Key Generator:** Admins can generate custom, secure alphanumeric license keys with configurable expiration durations.
*   **VIP Membership Toggle:** Elevate user profiles to VIP status, granting privileges and bypassing trial checks.
</details>

---

## 📊 AtikMeet vs Zoom vs Google Meet

| Feature | 🌐 AtikMeet | 👥 Google Meet | 📞 Zoom |
| :--- | :---: | :---: | :---: |
| **Duration Limit** | **Unlimited (Free)** | 60 Mins (Free) | 40 Mins (Free) |
| **Data Privacy** | **P2P (100% Private)** | Hosted on Google Servers | Hosted on Zoom Servers |
| **Lobby & Waiting Room** | **Included** | Included | Included |
| **Max Participants** | **Up to 150** | 100 (Free) | 100 (Free) |
| **Self-Hosting Server** | **Yes (Socket.io)** | No | No |
| **Custom License Control** | **Yes (Admin Key Gen)** | No | No |

---

## 📥 Quick Installation & Run

### 1. Installation
Clone the repository and install packages using your package manager:
```bash
git clone https://github.com/AtikShahriar01/AtikMeetSoft.git
cd AtikMeetSoft
npm install
```

### 2. Launching Desktop App
Run the following npm command to open the native Electron desktop shell:
```bash
npm run desktop
```

### 3. Packaging & Installation Installer
To compile your own distributable wizard setup (`AtikMeet-[version]-Wizard-Setup.exe`):
```bash
npm run make
```

---

## 🛡️ Admin Panel & Security

AtikMeet provides an administrative interface to monitor system statuses and manage licensing. 

*   **Default Admin Email:** `admin@atikmeet.com`
*   **Default Admin Password:** `admin123`
*   **Default Admin Key:** `ATIK-ADMIN-VIP-2026`

*To secure the app for production, modify these default credentials inside the configuration panel.*

---

## 💾 Standalone Server Setup

To run a remote signaling node, you can run the background server process silently:

1. Right-click on `setup-autostart.bat` and select **"Run as Administrator"**.
2. The script will automatically configure inbound Windows Defender Firewall rules for TCP and UDP port `3478`.
3. It registers `start-server-silent.vbs` to your Windows startup registry, allowing the signaling server to run silently on boot.

---

## 📧 Contact & Support

If you have questions, feedback, or would like to request custom licensing models, please contact us:

*   **📧 Email:** [atiksoykot979@gmail.com](mailto:atiksoykot979@gmail.com)
*   **🏢 Developed By:** **Atik Shahriar**

---

## 📄 License
This project is licensed under the MIT License. See `license.txt` for details.
