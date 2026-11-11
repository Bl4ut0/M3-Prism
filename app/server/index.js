require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const { getDatabasePath, getCacheDir, ensureDir } = require('./runtimePaths');
const { getRuntimeConfig } = require('./runtimeConfig');
const { decryptSecret, encryptSecret, JWT_SECRET } = require('./cryptoUtils');
const initDbSchema = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3001;

// --- 1. MIDDLEWARE & SYSTEM ---
app.use(express.json());
app.use(cookieParser());

// Request Pipeline Logger
app.use((req, res, next) => {
    res.on('finish', () => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode}`);
    });
    next();
});

// --- 2. DATABASE ---
const db = new Database(getDatabasePath(), { timeout: 5000 });
db.pragma('journal_mode = WAL');
initDbSchema(db);

const CACHE_DIR = getCacheDir();
ensureDir(CACHE_DIR);

const getExtension = (url, contentType) => {
    if (contentType?.includes('jpeg')) return '.jpg';
    if (contentType?.includes('png')) return '.png';
    if (contentType?.includes('webp')) return '.webp';
    const ext = path.extname(url).split('?')[0].toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext) ? ext : '.jpg';
};

// --- 3. AUTH & GATING ---
const { authMiddleware: createAuthMiddleware, setupAuthRoutes, setSessionCookie, clearSessionCookie, isSavedProfileLoginEnabled } = require('./auth');
const authMiddleware = createAuthMiddleware(db);

const setupMiddleware = (req, res, next) => {
    const profiles = db.prepare('SELECT COUNT(*) as count FROM profiles').get();
    if (profiles.count === 0) return next();
    return authMiddleware(req, res, next);
};

const getSetupState = () => {
    const profiles = db.prepare('SELECT COUNT(*) as count FROM profiles').get();
    const providers = db.prepare('SELECT COUNT(*) as count FROM providers').get();
    return {
        configured: profiles.count > 0 || providers.count > 0,
        profileCount: profiles.count,
        providerCount: providers.count,
        runtimeMode: process.env.M3PRISM_DESKTOP === 'true' ? 'desktop' : 'web',
        savedProfileLoginEnabled: isSavedProfileLoginEnabled(),
    };
};

// --- 4. ENGINE MODULES ---
const setupRoutes = require('./routes/setup')(db, getSetupState, setupMiddleware);
const providerRoutes = require('./routes/providers');
const profileRoutes = require('./routes/profiles');
const contentRoutes = require('./routes/content')(db, authMiddleware);
const proxyRoutes = require('./routes/proxy');

const streamProxy = require('./proxy');
const { startEPGSyncTimer, registerAndSync, getCachedEPG, getCachedEPGBatch, getEPGSyncStatus } = require('./epgSync');
const { startBackgroundScan } = require('./metadata');

const proxyMiddleware = streamProxy(db, decryptSecret);
startBackgroundScan(db).catch(e => console.error("[Metadata] Startup Error:", e.message));
startEPGSyncTimer(db);

// --- 5. REGISTRATION ---
app.use(['/api', '/'], setupRoutes);
app.use(['/api', '/'], providerRoutes(db, authMiddleware, setupMiddleware, registerAndSync, getCachedEPG, getCachedEPGBatch, getEPGSyncStatus, decryptSecret));
app.use(['/api', '/'], profileRoutes(db, authMiddleware, setupMiddleware, JWT_SECRET, decryptSecret, encryptSecret, setSessionCookie, clearSessionCookie, isSavedProfileLoginEnabled));
app.use(['/api', '/'], contentRoutes);
app.use(['/api', '/'], proxyRoutes(db, authMiddleware, proxyMiddleware, CACHE_DIR, getExtension, clearSessionCookie));

setupAuthRoutes(app, db);

// --- 6. FRONTEND ---
const distPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const config = getRuntimeConfig().config;
const HOST = process.env.HOST || (config.security?.allowRemote ? '0.0.0.0' : '127.0.0.1');

app.listen(PORT, HOST, () => {
    console.log(`[Server] M3 Prism Engine Online: http://${HOST}:${PORT}`);
    if (HOST === '127.0.0.1') console.log("[Security] Stealth Mode Active: Firewall bypass engaged.");
});
