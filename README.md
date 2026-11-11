# 💎 M3 Prism

**The ultimate multimedia powerhouse.** Play any codec, from any platform, in any language.

![M3 Prism Banner](https://img.shields.io/badge/M3_Prism-Multimedia_Powerhouse-blueviolet?style=for-the-badge&logo=prism)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)
[![Platform: Windows | Web | Android](https://img.shields.io/badge/Platform-Windows_%7C_Web_%7C_Android-orange?style=for-the-badge)](#)

---

## 🌟 What is M3 Prism?

M3 Prism is a high-performance multimedia player and home media hub designed to be the "one player for everything." Whether you are streaming high-bitrate m3u8 playlists, accessing local network files via **SMB/DLNA**, or organizing a massive library of local movies and music, M3 Prism refracts your media into a premium, cinematic experience.

### 🚀 Key Features

*   **📺 Universal Playback**: Native support for almost every media codec and format (legacy to modern).
*   **📂 Local Media Hub**: Drag-and-drop support for local files and advanced `.m3u`/`.pls` playlist management.
*   **🔗 Multi-Protocol**: Seamlessly handle `m3u8`, `xtream`, `DLNA`, `SMB`, and local system paths.
*   **🌍 Multi-Language**: Built for a global audience with localized UI support.
*   **🎨 Premium UI**: A modern, vibrant interface with glassmorphism, dynamic backdrops, and cinematic transitions.
*   **💻 Cross-Platform**: Run as a desktop app (Electron), a self-hosted web server (Node/Vite), or a mobile app (Android via Capacitor).

---

## 🛠️ Getting Started

### For Users (Desktop)
1. Download the latest installer from the **[Releases](https://github.com/your-repo/releases)** page.
2. Run the installer and launch M3 Prism.
3. Add your providers or local paths and start watching.

### For Developers (Self-Hosted)
```bash
# Clone the repository
git clone https://github.com/your-username/M3Prism.git

# Enter the application folder (The workspace)
cd app

# Install dependencies
npm install

# Start the development environment (Parallel)
npm run dev
```

---

## 💎 Custom Builds & Whitelabeling (Locked Mode)

M3 Prism supports a **"Locked Mode"** designed for custom deployments where you want to offer a pre-configured service set.

### How to Pre-configure Providers:
1. Navigate to `app/config/`.
2. Create a file named `providers.json` (or rename `providers.example.json`).
3. Add your Xtream Codes or M3U provider details to this file.
4. When you build or start the app, M3 Prism will detect this file and **lock the interface**.

### Global Settings:
*   **`main.json`**: Configure your TMDB API keys and global User-Agent.
*   **`server.json`**: Configure backend engine settings like sync intervals.

**What happens in Locked Mode?**
*   General onboarding screens are bypassed.
*   The user cannot add custom IPTV providers or M3U strings.
*   Users see a restricted "Sign In" window where they can only choose from your pre-defined providers to create their local profile.

This file is automatically ignored by Git to prevent accidental leaks of your service credentials.

---

## 📂 Project Organization

To keep the system efficient and maintainable, we use a structured monorepo:

*   **/app**: The core application workspace (All code and build logic lives here).
    *   **/client**: The Vite-powered React frontend (The Prism UI).
    *   **/server**: The Node.js backend (The engine: Proxy, EPG Sync, Metadata).
    *   **main.js**: The Electron shell entry point.
*   **/docs**: Technical documentation, roadmap, and release guides.
*   **/release**: Finished production builds (Windows Installers, etc.).

---

## ⚖️ License & Legal

M3 Prism is licensed under the **GNU Affero General Public License v3 (AGPL-3.0)**. 

If you wish to contribute, please check our **[Contributing Guide](docs/CONTRIBUTING.md)** and sign our **[CLA](docs/CLA.md)**. 

> [!NOTE]
> The owner of M3 Prism maintains the right to dual-license the software for official application stores (Google Play, Apple App Store).

---

## 🛤️ Roadmap
Interested in where we're going? Check out the **[Development Planning](docs/PLANNING.md)** document.

---

*Built with ❤️ for the multimedia community.*
