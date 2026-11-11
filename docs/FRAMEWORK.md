# M3 Prism: The "Refractive" Framework Roadmap

M3 Prism is designed to be a unified, universal IPTV ecosystem that provides a seamless, premium experience across Web, Desktop, and Mobile environments.

## 🏁 The Vision
To maintain a **single codebase** that generates native applications for Windows, macOS, Android, iOS, and high-performance Web environments, while preserving Whitelabel and "Locked Mode" capabilities.

## 🏗️ Structural Layers

### 1. The Core (Logic Engine)
Location: `/app/core`
- **Responsibility**: M3U Parsing, Xtream API Mapping, EPG Synchronization, Search Indexing.
- **Goal**: Run the exact same JavaScript logic on an iPhone, a Windows PC, and a Chrome browser.

### 2. The Adapters (Platform Bridge)
Location: `/app/adapters`
- **Responsibility**: Translating generic Core requests into platform-specific actions.
- **Examples**:
    - `StorageAdapter`: Swaps between Node `fs`, Browser `IndexedDB`, and Mobile `SQLite`.
    - `NetworkAdapter`: Swaps between Axios (Node/Web) and Native Fetch (Mobile).

### 3. The Interface (Universal UI)
Location: `/app/client`
- **Responsibility**: The high-end, cinematic React frontend.
- **Tech Stack**: React, TailwindCSS, Framer Motion.
- **Optimization**: Modular splitting to ensure fast boot times on low-power mobile devices.

## 📱 Implementation Targets

| Target | Technology | Status |
| :--- | :--- | :--- |
| **Desktop (Win/Mac)** | Electron / Node.js | ✅ Operational |
| **Web (Cloud)** | Node.js / Express | ✅ Operational |
| **Mobile (Android/iOS)** | Capacitor / React Native | 📅 Planned |
| **TV (Android TV/Tizen)** | Capacitor / WebPort | 📅 Researching |

## 💎 Whitelabel Framework
The framework supports "Seed-based" builds. By placing a `providers.json` in the `/config` vault, the framework automatically locks its UI and transforms into a dedicated service player for a specific provider, bypassing general onboarding.
