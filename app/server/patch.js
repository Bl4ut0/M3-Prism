const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// 1. imports
code = code.replace(/app\.use\(cors\(\)\);/, 'app.use(cors({ origin: true, credentials: true }));');
code = code.replace(/const crypto = require\('crypto'\);/, "const crypto = require('crypto');\nconst cookieParser = require('cookie-parser');");

// 2. middleware
code = code.replace(/app\.use\(express\.json\(\)\);/, "app.use(express.json());\napp.use(cookieParser());");

// 3. auth setup
code = code.replace(/initDb\(\);\n\n\/\/ Routes/, "initDb();\n\nconst { authMiddleware, setupAuthRoutes } = require('./auth');\nsetupAuthRoutes(app, db);\n\n// Routes");

// 4. patches
const routesToPatch = [
    "app.put('/api/providers/:id/timeshift'",
    "app.post('/api/sync/all'",
    "app.post('/api/epg/register'",
    "app.get('/api/epg/:streamId'",
    "app.post('/api/epg/batch'",
    "app.get('/api/epg/status'",
    "app.post('/api/metadata/scan'",
    "app.get('/api/channels'",
    "app.get('/api/categories'",
    "app.get('/api/vod/categories'",
    "app.get('/api/vod/items'",
    "app.post('/api/metadata/update'",
    "app.post('/api/progress'",
    "app.get('/api/progress/:userId/:streamId'",
    "app.get('/api/progress/list/:userId/:type'",
    "app.get('/api/config/proxy'",
    "app.get('/api/proxy'",
    "app.get('/api/assets'"
];

for (const route of routesToPatch) {
    code = code.replace(route, route + ", authMiddleware");
}

fs.writeFileSync('index.js', code);
console.log('Patched index.js lines successfully');
