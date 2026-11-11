## 🪟 Windows (Desktop Application)
We use `electron-builder` to create installers and portable executables.

> [!IMPORTANT]
> All build commands must be run from the `app/` directory.

### Build Commands
1. **Clean prior builds**: `npm run clean`
2. **Build the installer**: `npm run dist`
3. **Build portable version**: `npx electron-builder --win portable`

---

## 🌐 Web (Self-Hosted / Docker / NAS)
1. **Build Frontend**: Run `npm run build:client` from inside `app/`.
2. **Server config**: Ensure `app/server/index.js` points to `app/client/dist`.
3. **Run**: `node server/index.js` (from inside `app/`)
   *Access via `http://localhost:3001`*

---

## 🤖 Android (Universal App)
1. **Prepare Web Code**: `npm run build:client`
2. **Sync with Android**: `npx cap sync android`
3. **Build APK**: Use Android Studio `Build > Build APK`.

---

*Last Updated: 2026-04-20*
