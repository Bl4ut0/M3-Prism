# M3 Prism: Build & Architecture Guidelines

This document outlines the core architectural principles and build standards for M3 Prism. Adherence to these guidelines ensures cross-platform compatibility and system stability.

## 1. Centralized Configuration (The Vault)
All persistent application data MUST be stored in the `/app/config/` directory.

- **`main.json`**: Global identity, branding, and API keys.
- **`server.json`**: Backend engine and sync intervals.
- **`providers.json`**: Pre-configured IPTV provider data (Whitelabel/Locked Mode).
- **`user_data.db`**: The primary SQLite database.
- **`cache/`**: Temporary artwork and metadata assets.

## 2. Universal Core Principles
M3 Prism is moving toward a **Headless Core** architecture. 
- **Logic Isolation**: Any IPTV parsing, EPG matching, or data processing logic should be moved to `/app/core`.
- **Platform Agnosticism**: Core logic MUST NOT depend on Node.js-specific modules (like `fs`) without a proper adapter interface.
- **Adapters**: Device-specific functionality (like storage or networking) must be implemented via the `/app/adapters` layer.

## 3. Server Modularization
The backend server (`/app/server`) is a modular Express environment.
- **Route Isolation**: New API endpoints must be created as separate modules in `/app/server/routes/`.
- **Statelessness**: Favor database-driven state over in-memory session state to support system persistence across restarts.

## 4. Branding & Identity
- **User-Agent**: The default User-Agent for all external requests is `M3Prism/1.0`.
- **Customization**: Identity overrides can be applied globally in `main.json` or per-provider in `providers.json`.

## 5. Security & Privacy
- **Encryption**: Sensitive credentials (passwords, M3U URLs) MUST be encrypted in the database using the internal encryption modules.
- **Git Exposure**: Ensure `.gitignore` is updated to block any private JSON or DB files in the `/app/config/` directory while allowing `.example.json` templates.
