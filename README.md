# 🌐 AtikMeet - Professional Video Conferencing Desktop App

AtikMeet is a premium, lightweight, self-hosted video conferencing application built with **Electron**, **WebRTC**, and **Socket.io**. It is designed to run either as a native desktop application or as a standalone background web server, enabling seamless peer-to-peer real-time video, audio, screen sharing (1080p), chat, and reactions.

---

## 🚀 Key Features

*   **⚡ WebRTC P2P Call Engines:** Low latency, high-quality audio and video communication directly between peers.
*   **🖥️ High-Definition Screen Sharing:** Support for up to 1080p desktop screen sharing with system loopback audio integration.
*   **👥 Room Moderator Controls:** Room host handles admissions/rejections through a secure waiting room/lobby.
*   **⚙️ Dual Runtime Modes:**
    *   **Desktop App:** Frameless native Electron window with customized styling, hardware acceleration, and integrated auto-updater.
    *   **Standalone Server:** Background Node.js server (`server-standalone.js`) starting silently on boot to host remote/LAN connections.
*   **🔑 License Key & Trial System:** Built-in trial validation (7 days) with dynamic license activation keys and VIP statuses.
*   **🛡️ Comprehensive Admin Dashboard:** Manage active meetings, ban/unban users, configure roles, and generate custom license keys.
*   **📂 Lightweight Data Store:** Utilizes **lowdb** (JSON file-based database) for fast and zero-configuration data management.
*   **🔌 Auto-Run & Firewall configuration:** Custom scripts (`setup-autostart.bat`, `start-server-silent.vbs`) to automatically open firewall ports and launch the background signaling server silently on Windows start.

---

## 📁 Repository Directory Structure

```filepath
AtikMeetSoft/
├── assets/                     # Graphic assets (icons, badges, background images)
├── data/                       # Database directory
│   └── db.json                 # lowdb JSON data store (users, licenses, meetings, settings)
├── src/                        # Main frontend & backend source code
│   ├── css/                    # Modular vanilla CSS stylesheets
│   ├── js/                     # Client-side JavaScript modules (auth, meeting, chat, etc.)
│   ├── pages/                  # HTML views (login, admin dashboard, meeting room, profile)
│   └── utils/                  # Core utility helpers (signaling server, DB methods, API client)
├── atikmeet.iss                # Inno Setup installation wizard configuration script
├── forge.config.js             # Electron Forge packaging configuration
├── main.js                     # Electron Main process entry point
├── preload.js                  # Electron context isolation API bridge
├── server-standalone.js        # Background server launcher for hosting independent server
├── setup-autostart.bat         # Windows auto-start & firewall configurator
└── start-server-silent.vbs     # VBScript for running background Node.js process silently
```

---

## 🛠️ Technology Stack

*   **Frontend:** HTML5, Vanilla CSS (modular stylesheets), JavaScript (ES6+ client-side logic).
*   **Desktop Shell:** Electron (with secure `contextBridge` context isolation).
*   **Signaling & WebRTC:** Socket.io (Socket.io-client for signaling peer handshakes) & native WebRTC API.
*   **Database:** lowdb (v1.x synchronous file adapter).
*   **Installer:** Inno Setup Compiler.

---

## ⚙️ Installation & Setup

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended) on your machine.

### 1. Clone & Install Dependencies
Clone this repository to your local directory and install the required npm packages:
```bash
git clone https://github.com/AtikShahriar01/AtikMeetSoft.git
cd AtikMeetSoft
npm install
```

### 2. Configure Firewall & Windows Startup (Optional)
To run the server in standalone background mode, right-click `setup-autostart.bat` and select **"Run as Administrator"**. This script:
1. Adds inbound rules for TCP and UDP port `3478` to the Windows Defender Firewall.
2. Registers `start-server-silent.vbs` to your Windows Startup folder to run the server on Windows boot.
3. Automatically launches the background Node.js process silently.

---

## 🏃 Running the Application

### Development Mode

*   **Start Desktop Electron App:**
    ```bash
    npm run desktop
    ```
*   **Start Local Signaling Server:**
    ```bash
    npm run start
    ```

### Production Build / Packaging

To compile and package the Electron application for distribution:
```bash
npm run make
```
The compiled installation files will be exported to the `/out` directory. You can compile the Windows Installer installer (.exe Wizard Setup) using `atikmeet.iss` and the Inno Setup compiler.

---

## 🛡️ Admin & Default Credentials

When running the application for the first time, a default Administrator user is seeded automatically.

*   **Default Admin Username:** `admin@atikmeet.com`
*   **Default Admin Password:** `admin123`
*   **Default VIP License Key:** `ATIK-ADMIN-VIP-2026`

---

## 📝 Developer Recommendations & Best Practices

As a professional developer, here are key areas to optimize and customize:

1.  **Avoid Hardcoded Paths:**
    The scripts `setup-autostart.bat` and `start-server-silent.vbs` currently contain hardcoded drive-letter absolute paths (e.g., `e:\google meet`). Using dynamic paths like `%~dp0` in bat files and script-path-relative directories in VBS will make the application completely portable across different developer PCs.
2.  **Environment Variables:**
    Move credentials and signaling URL configurations (`CENTRAL_SERVER_URL`, `SIGNALING_PORT`) to a `.env` configuration file rather than hardcoding them in `main.js`.
3.  **STUN/TURN Servers:**
    Currently, the application relies on Google's free STUN servers. For production deployment across different networks (restrictive firewalls/symmetric NATs), hosting and configuring a custom **coturn** TURN server is highly recommended.
4.  **Database Scalability:**
    Lowdb works perfectly for local data persistence and development. If scaling the server to support thousands of active users, migrating the data layer to MongoDB or PostgreSQL is recommended.

---

## 📄 License
This project is licensed under the MIT License. See `license.txt` for details.
