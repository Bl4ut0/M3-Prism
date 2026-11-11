# M3 Prism: Development Roadmap & Release Strategy

This document outlines the pending code updates, build optimizations, and release frameworks for **M3 Prism**.

## 1. Project Rebranding & Polish (Immediate)
- [ ] **Asset Extraction**: Extract individual icons and backdrops from the `rebranding_suite.png`.
- [ ] **UI Update**: Replace all instances of "WebPlayer" with "M3 Prism".
- [ ] **Cinematic Details**: Finalize the TV Series detail overlay with dynamic backdrops.
- [ ] **Search Optimization**: Fix the 401 Unauthorized errors in global search post-restart.

## 2. Build Efficiency & Cleanup
- [x] **Parallelize Builds**: Updated root scripts to run `client` and `server` preparation in parallel using `concurrently`.
- [ ] **Clean Scripts**: Added `npm run clean` to wipe `release` and `build` folders.
- [ ] **Shared Types/Utils**: Move shared models (e.g., Channel types) to a `shared/` directory.

## 3. Release Frameworks

### 🪟 Windows (Desktop)
- **Tool**: `electron-builder`.
- **Status**: Configured.
- **Command**: `npm run dist`.

### 🌐 Web (Self-Hosted)
- **Tool**: Vite + Node.js (Express).
- **Goal**: Create a standalone "Server-Only" package that serves the Vite `dist` folder.
- [ ] **Dockerization**: Create a `Dockerfile` for easy deployment on NAS.

### 🤖 Android
- **Tool**: **Capacitor**.
- **Strategy**: Wrap the Vite client using Capacitor.
- [ ] **Drafting Android Wrapper**: Initialize `@capacitor/android`.

## 4. Universal Media Hub (The "Powerhouse" Goal)
M3 Prism aims to be the definitive home media hub, capable of playing **any** video or audio format from any era.

- [ ] **High-Compatibility Engine**: Implement an engine (e.g., using **MPV** or **FFmpeg-WASM**) to handle legacy and specialized codecs (AVI, MKV, HEVC, FLAC, etc.) that standard browsers cannot play.
- [ ] **Local Direct Play**: Add the ability to open and play local files/playlists directly via drag-and-drop or file browser.
- [ ] **Home Media Hub**: Build a dedicated "Library" view for local movies, music, and home videos.
- [ ] **Advanced Playlists**: Support for `.m3u`, `.pls`, and custom JSON playlists for mixed media (Audio + Video).
- [ ] **DLNA/SMB/Network Discovery**: Finalize the deep integration for network-attached storage (NAS) streaming.

---

*Last Updated: 2026-04-20*
