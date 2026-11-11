const fs = require('fs');

const part1 = `require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { getRuntimeConfig, updateRuntimeConfig } = require('./runtimeConfig');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Request Logger
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.url} - \${res.statusCode}\`);
  });
  next();
});

// Database Setup
const db = new Database('user_data.db', { verbose: console.log });
db.pragma('journal_mode = WAL');

// --- Asset Caching System ---
const CACHE_DIR = path.join(__dirname, 'cache', 'assets');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Helper to get extension from content-type or url
const getExtension = (url, contentType) => {
  if (contentType) {
    if (contentType === 'image/jpeg') return '.jpg';
    if (contentType === 'image/png') return '.png';
    if (contentType === 'image/webp') return '.webp';
  }
  const ext = path.extname(url).split('?')[0].toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) return ext;
  return '.jpg'; // Default
};
`;

const part2 = `
const initDb = () => {
  db.exec(\`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT DEFAULT 'xtream',
      timeshift INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS channels (
      stream_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      stream_icon TEXT,
      category_id TEXT,
      num INTEGER,
      epg_channel_id TEXT,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS epg_listings (
      id TEXT PRIMARY KEY,
      stream_id INTEGER,
      provider_id TEXT,
      title TEXT,
      description TEXT,
      start_time TEXT,
      stop_time TEXT
    );
    CREATE TABLE IF NOT EXISTS vod_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS series_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS vod_active (
      stream_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      stream_icon TEXT,
      category_id TEXT,
      container_extension TEXT,
      rating TEXT,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS series_active (
      series_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cover TEXT,
      category_id TEXT,
      rating TEXT,
      provider_id TEXT
    );
    CREATE TABLE IF NOT EXISTS watch_history (
      user_id TEXT,
      stream_id TEXT,
      resume_time INTEGER,
      duration INTEGER,
      last_watched TEXT,
      type TEXT,
      parent_id TEXT,
      name TEXT,
      poster TEXT,
      PRIMARY KEY (user_id, stream_id)
    );
    CREATE TABLE IF NOT EXISTS metadata_overrides (
      item_id TEXT,
      type TEXT,
      poster TEXT,
      backdrop TEXT,
      logo TEXT,
      PRIMARY KEY (item_id, type)
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'xtream',
      provider_id TEXT,
      username TEXT,
      password TEXT,
      m3u_url TEXT,
      is_active INTEGER DEFAULT 0,
      last_used TEXT,
      created_at TEXT,
      user_agent TEXT,
      timeshift INTEGER DEFAULT 0
    );
  \`);

  // Migration for timeshift if table already existed
  try {
    const tableInfo = db.prepare("PRAGMA table_info(providers)").all();
    if (!tableInfo.find(c => c.name === 'timeshift')) {
      db.exec("ALTER TABLE providers ADD COLUMN timeshift INTEGER DEFAULT 0");
      console.log("Migration: Added timeshift column to providers table.");
    }
  } catch (e) {
    console.error("Migration failed:", e.message);
  }

  // Migration for Watch History Metadata
  try {
    const tableInfo = db.prepare("PRAGMA table_info(watch_history)").all();
    if (!tableInfo.find(c => c.name === 'type')) {
      db.exec("ALTER TABLE watch_history ADD COLUMN type TEXT");
      db.exec("ALTER TABLE watch_history ADD COLUMN parent_id TEXT");
      db.exec("ALTER TABLE watch_history ADD COLUMN name TEXT");
      db.exec("ALTER TABLE watch_history ADD COLUMN poster TEXT");
      console.log("Migration: Added metadata columns to watch_history table.");
    }
  } catch (e) {
    console.error("Watch History Migration failed:", e.message);
  }

  // Migration for EPG provider_id
  try {
    const tableInfo = db.prepare("PRAGMA table_info(epg_listings)").all();
    if (!tableInfo.find(c => c.name === 'provider_id')) {
      db.exec("ALTER TABLE epg_listings ADD COLUMN provider_id TEXT");
      console.log("Migration: Added provider_id column to epg_listings table.");
    }
  } catch (e) {
    console.error("EPG Migration failed:", e.message);
  }

  // Seed/Update providers from JSON config
  try {
    const { getProviderConfigPaths } = require('./runtimePaths');
    const paths = getProviderConfigPaths();
    
    let configPath = null;
    let isExternalConfig = false;

    if (fs.existsSync(paths.userDataPath)) {
        configPath = paths.userDataPath; // user_data/servers.json
        isExternalConfig = true;
    } else if (fs.existsSync(paths.externalPath)) {
        configPath = paths.externalPath; // exe_dir/servers.json
        isExternalConfig = true;
    } else if (process.env.USER_DATA_DIR && fs.existsSync(path.join(process.env.USER_DATA_DIR, 'providers.json'))) {
        configPath = path.join(process.env.USER_DATA_DIR, 'providers.json');
        isExternalConfig = true;
    } else if (process.env.EXE_DIR && fs.existsSync(path.join(process.env.EXE_DIR, 'providers.json'))) {
        configPath = path.join(process.env.EXE_DIR, 'providers.json');
        isExternalConfig = true;
    } else if (fs.existsSync(paths.legacyPath)) {
        configPath = paths.legacyPath; // server/providers.json
    }

    if (configPath && fs.existsSync(configPath)) {
      const providers = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const insert = db.prepare('INSERT OR REPLACE INTO providers (id, name, url, type, timeshift) VALUES (?, ?, ?, ?, ?)');

      db.transaction(() => {
        if (isExternalConfig) {
           db.prepare('DELETE FROM providers').run();
        }
        for (const p of providers) {
          insert.run(p.id, p.name, p.url, p.type || 'xtream', p.timeshift || 0);
        }
      })();
      console.log(\`Loaded \${providers.length} providers from config file: \${configPath}\`);
    } else {
      console.log('No external or legacy providers configuration found.');
    }
  } catch (err) {
    console.error('Failed to load providers check:', err.message);
  }
};

const getSetupState = () => {
    const profiles = db.prepare('SELECT COUNT(*) as count FROM profiles').get();
    const providers = db.prepare('SELECT COUNT(*) as count FROM providers').get();
    const configured = profiles.count > 0 || providers.count > 0;

    let mode = null;
    if (profiles.count > 0) {
        const active = db.prepare('SELECT type FROM profiles WHERE is_active = 1').get();
        mode = active ? active.type : 'xtream';
    } else if (providers.count > 1) {
        mode = 'multi';
    }

    return {
        configured,
        mode,
        profileCount: profiles.count,
        providerCount: providers.count,
    };
};

initDb();
`;

const part3 = `
const { authMiddleware: createAuthMiddleware, setupAuthRoutes, JWT_SECRET } = require('./auth');
const authMiddleware = createAuthMiddleware(db);
setupAuthRoutes(app, db);

const decryptSecret = (value) => {
  if (!value) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    crypto.createHash('sha256').update(JWT_SECRET).digest(),
    Buffer.alloc(16, 0)
  );
  return decipher.update(value, 'hex', 'utf8') + decipher.final('utf8');
};

const encryptSecret = (value) => {
  if (!value) return null;
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    crypto.createHash('sha256').update(JWT_SECRET).digest(),
    Buffer.alloc(16, 0)
  );
  return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
};

app.get('/api/status', (req, res) => {
  res.json({ status: 'online', version: '1.0.0' });
});

// Setup Status Check
app.get('/api/setup/status', (req, res) => {
    res.json(getSetupState());
});

// Runtime Config Handlers
app.get('/api/runtime/config', (req, res) => {
    res.json(getRuntimeConfig());
});

app.put('/api/runtime/config', (req, res) => {
    const config = updateRuntimeConfig(req.body);
    res.json(config);
});

app.get('/api/providers', (req, res) => {
  const stmt = db.prepare('SELECT * FROM providers');
  const providers = stmt.all();
  res.json(providers);
});

app.post('/api/providers', authMiddleware, (req, res) => {
    const { name, url, type } = req.body;
    const id = \`provider_\${Date.now()}\`;
    const stmt = db.prepare('INSERT INTO providers (id, name, url, type) VALUES (?, ?, ?, ?)');
    stmt.run(id, name, url, type || 'xtream');
    res.json({ success: true, id });
});

app.put('/api/providers/:id/timeshift', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { timeshift } = req.body;
  try {
    const stmt = db.prepare('UPDATE providers SET timeshift = ? WHERE id = ?');
    stmt.run(timeshift, id);
    res.json({ success: true, timeshift });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const streamProxy = require('./proxy');
const { syncData, syncEPG } = require('./sync');
const { scanLibrary, startBackgroundScan } = require('./metadata');
const { registerAndSync: registerEPGSync, startEPGSyncTimer, getCachedEPG, getCachedEPGBatch, getEPGSyncStatus } = require('./epgSync');

const proxyMiddleware = streamProxy(db, decryptSecret);

startBackgroundScan(db).catch(e => console.error("Startup Scan Error:", e.message));
startEPGSyncTimer(db);

app.post('/api/sync/all', authMiddleware, async (req, res) => {
  const { providerId, user } = req.body;
  if (!providerId || !user) return res.status(400).json({ error: 'Missing providerId or user' });
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  const result = await syncData(db, provider, user);
  res.json(result);
});

app.post('/api/epg/register', authMiddleware, async (req, res) => {
  const { providerId, user } = req.body;
  if (!providerId || !user || !user.username || !user.password) {
    return res.status(400).json({ error: 'Missing providerId or user credentials' });
  }
  try {
    await registerEPGSync(db, providerId, user);
    res.json({ success: true, message: 'EPG sync started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/epg/:streamId', authMiddleware, (req, res) => {
  const { streamId } = req.params;
  const { providerId } = req.query;
  const listings = getCachedEPG(db, parseInt(streamId, 10), providerId);
  res.json({ epg_listings: listings });
});

app.post('/api/epg/batch', authMiddleware, (req, res) => {
  const { streamIds, providerId } = req.body;
  if (!streamIds || !Array.isArray(streamIds)) {
    return res.status(400).json({ error: 'Missing streamIds array' });
  }
  const grouped = getCachedEPGBatch(db, streamIds.map(id => parseInt(id, 10)), providerId);
  res.json(grouped);
});

app.get('/api/epg/status', authMiddleware, (req, res) => {
  res.json(getEPGSyncStatus());
});

app.get('/api/channels', authMiddleware, (req, res) => {
  const { categoryId, providerId } = req.query;
  let query = \`
    SELECT t.*, 
           COALESCE(m.poster, t.stream_icon) as stream_icon,
           m.logo as logo
    FROM channels t
    LEFT JOIN metadata_overrides m ON m.item_id = CAST(t.stream_id AS TEXT) AND m.type = 'channel'
    WHERE 1=1
  \`;
  const params = [];
  if (providerId) { query += ' AND t.provider_id = ?'; params.push(providerId); }
  if (categoryId) { query += ' AND t.category_id = ?'; params.push(categoryId); }
  query += ' ORDER BY t.num ASC';
  const stmt = db.prepare(query);
  res.json(stmt.all(...params));
});

app.get('/api/categories', authMiddleware, (req, res) => {
  const { providerId } = req.query;
  let query = 'SELECT * FROM categories';
  const params = [];
  if (providerId) { query += ' WHERE provider_id = ?'; params.push(providerId); }
  query += ' ORDER BY name ASC';
  const stmt = db.prepare(query);
  res.json(stmt.all(...params));
});

app.get('/api/vod/categories', authMiddleware, (req, res) => {
  const { providerId, type } = req.query;
  const table = type === 'series' ? 'series_categories' : 'vod_categories';
  try {
    const stmt = db.prepare(\`SELECT * FROM \${table} WHERE provider_id = ? ORDER BY name ASC\`);
    res.json(stmt.all(providerId));
  } catch (err) { res.json([]); }
});

app.get('/api/vod/items', authMiddleware, (req, res) => {
  const { providerId, type, categoryId } = req.query;
  if (type !== 'series' && type !== 'movie') return res.json([]);
  const table = type === 'series' ? 'series_active' : 'vod_active';
  const idColumn = type === 'series' ? 'series_id' : 'stream_id';
  let query = \`
    SELECT t.*, 
           COALESCE(m.poster, \${type === 'series' ? 't.cover' : 't.stream_icon'}) as poster, 
           m.backdrop as backdrop,
           m.logo as logo
    FROM \${table} t
    LEFT JOIN metadata_overrides m ON m.item_id = CAST(t.\${idColumn} AS TEXT) AND m.type = ?
    WHERE t.provider_id = ?
  \`;
  const params = [type, providerId];
  if (categoryId) { query += ' AND t.category_id = ?'; params.push(categoryId); }
  const stmt = db.prepare(query);
  res.json(stmt.all(...params));
});

app.post('/api/metadata/update', authMiddleware, (req, res) => {
  const { itemId, type, poster, backdrop, logo } = req.body;
  const stmt = db.prepare(\`
      INSERT OR REPLACE INTO metadata_overrides (item_id, type, poster, backdrop, logo)
      VALUES (?, ?, ?, ?, ?)
  \`);
  stmt.run(String(itemId), type, poster, backdrop, logo);
  res.json({ success: true });
});

app.post('/api/progress', authMiddleware, (req, res) => {
  const { userId, streamId, type, parentId, name, poster, time, duration } = req.body;
  if (!userId || !streamId) return res.status(400).send("Missing IDs");
  if (duration > 0 && time > (duration * 0.95)) {
    db.prepare('DELETE FROM watch_history WHERE user_id = ? AND stream_id = ?').run(userId, String(streamId));
    return res.json({ success: true, status: 'completed' });
  }
  const stmt = db.prepare(\`
          INSERT OR REPLACE INTO watch_history (user_id, stream_id, type, parent_id, name, poster, resume_time, duration, last_watched)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`);
  stmt.run(userId, String(streamId), type || 'movie', parentId || null, name || 'Unknown Title', poster || '', Math.floor(time), Math.floor(duration), new Date().toISOString());
  res.json({ success: true });
});

app.get('/api/progress/:userId/:streamId', authMiddleware, (req, res) => {
  const { userId, streamId } = req.params;
  const stmt = db.prepare('SELECT * FROM watch_history WHERE user_id = ? AND stream_id = ?');
  const data = stmt.get(userId, streamId);
  res.json(data || { resume_time: 0 });
});

app.post('/api/profiles', authMiddleware, (req, res) => {
    const { name, type, provider_id, username, password, m3u_url, user_agent, timeshift } = req.body;
    const id = \`profile_\${Date.now()}\`;
    const stmt = db.prepare(\`
        INSERT INTO profiles (id, name, type, provider_id, username, password, m3u_url, user_agent, timeshift, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`);
    stmt.run(id, name, type || 'xtream', provider_id, username, password ? encryptSecret(password) : null, m3u_url, user_agent, timeshift || 0, new Date().toISOString());
    res.json({ success: true, id });
});

app.put('/api/profiles/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const { name, user_agent, timeshift } = req.body;
    db.prepare('UPDATE profiles SET name = ?, user_agent = ?, timeshift = ? WHERE id = ?').run(name, user_agent, timeshift || 0, id);
    res.json({ success: true });
});

app.delete('/api/profiles/:id', authMiddleware, (req, res) => {
    db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/profiles', authMiddleware, (req, res) => {
    res.json(db.prepare('SELECT id, name, type, provider_id, username, user_agent, timeshift FROM profiles').all());
});

app.post('/api/profiles/:id/login', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(profile.provider_id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const password = profile.password ? decryptSecret(profile.password) : null;
    const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;

    const response = await axios.get(\`\${baseUrl}/player_api.php\`, {
        params: { username: profile.username, password },
        timeout: 10000
    });

    if (response.data?.user_info?.auth === 1) {
        const { setSessionCookie } = require('./auth');
        setSessionCookie(res, {
            username: profile.username,
            providerId: provider.id,
            serverUrl: baseUrl,
            profileId: profile.id,
            userInfo: response.data.user_info
        }, req);
        res.json({ success: true, user_info: response.data.user_info, provider });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/api/profiles/:id/credentials', authMiddleware, (req, res) => {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ ...profile, password: profile.password ? decryptSecret(profile.password) : null });
});

app.get('/api/config/proxy', authMiddleware, (req, res) => {
  const result = db.prepare("SELECT value FROM settings WHERE key = 'proxy_enabled'").get();
  res.json({ proxyEnabled: result ? JSON.parse(result.value) : true });
});

app.get('/api/proxy', authMiddleware, proxyMiddleware);

app.get('/api/assets', authMiddleware, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const existingFiles = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(hash));
  if (existingFiles.length > 0) return res.sendFile(path.join(CACHE_DIR, existingFiles[0]));
  const response = await axios.get(decodeURIComponent(url), { responseType: 'stream', timeout: 10000 });
  const filename = \`\${hash}\${getExtension(url, response.headers['content-type'])}\`;
  const stream = fs.createWriteStream(path.join(CACHE_DIR, filename));
  response.data.pipe(stream);
  stream.on('finish', () => res.sendFile(path.join(CACHE_DIR, filename)));
});

app.post('/api/factory-reset', (req, res) => {
    db.exec('DELETE FROM channels; DELETE FROM categories; DELETE FROM epg_listings; DELETE FROM vod_active; DELETE FROM vod_categories; DELETE FROM series_active; DELETE FROM series_categories; DELETE FROM metadata_overrides; DELETE FROM watch_history; DELETE FROM settings; DELETE FROM profiles; DELETE FROM providers;');
    const { clearSessionCookie } = require('./auth');
    clearSessionCookie(res, req);
    res.json({ success: true });
});

const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));
app.get(/^(?!\\/api).+/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server running on port \${PORT}\`);
});
`;

fs.writeFileSync('index.js', part1 + part2 + part3);
