const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * STREAMING PROXY & MAINTENANCE
 * Handles the secure relay of media streams and the local caching of remote artwork.
 * Also manages system resets and historical data cleanup.
 */
module.exports = (db, authMiddleware, proxyMiddleware, CACHE_DIR, getExtension, clearSessionCookie) => {

    const isKnownAssetUrl = (url) => {
        const lookups = [
            ['channels', 'stream_icon'],
            ['vod_active', 'stream_icon'],
            ['series_active', 'cover'],
            ['metadata_overrides', 'poster'],
            ['metadata_overrides', 'backdrop'],
            ['metadata_overrides', 'logo'],
        ];
        return lookups.some(([table, column]) => db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(url));
    };

    // Proxy Settings
    router.get('/config/proxy', authMiddleware, (req, res) => {
        const result = db.prepare("SELECT value FROM settings WHERE key = 'proxy_enabled'").get();
        res.json({ proxyEnabled: result ? JSON.parse(result.value) : true });
    });

    // Main Stream Proxy Node
    router.get('/proxy', authMiddleware, proxyMiddleware);
    router.get('/stream/direct', authMiddleware, proxyMiddleware);

    // Asset Cache Proxy (Artwork/Posters)
    router.get('/assets', authMiddleware, async (req, res) => {
        const { url } = req.query;
        if (!url) return res.status(400).send('Missing url');
        
        try {
            const decodedUrl = decodeURIComponent(url);
            const target = new URL(decodedUrl);
            if (!['http:', 'https:'].includes(target.protocol) || !isKnownAssetUrl(decodedUrl)) {
                return res.status(403).json({ error: 'Asset URL is not part of the media library' });
            }

            const hash = crypto.createHash('md5').update(decodedUrl).digest('hex');
            const existingFiles = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(hash));
            
            if (existingFiles.length > 0) {
                return res.sendFile(path.join(CACHE_DIR, existingFiles[0]));
            }

            const response = await axios.get(decodedUrl, {
                responseType: 'arraybuffer',
                timeout: 10000,
                maxRedirects: 3,
                maxContentLength: 10 * 1024 * 1024,
                maxBodyLength: 10 * 1024 * 1024,
            });
            const contentType = String(response.headers['content-type'] || '').toLowerCase();
            if (!contentType.startsWith('image/')) {
                return res.status(415).json({ error: 'Remote asset is not an image' });
            }

            const filename = `${hash}${getExtension(decodedUrl, contentType)}`;
            const destPath = path.join(CACHE_DIR, filename);
            fs.writeFileSync(destPath, response.data);
            return res.sendFile(destPath);
        } catch (err) {
            res.status(502).json({ error: 'Failed to fetch remote artwork' });
        }
    });

    // --- SYSTEM RESETS ---

    // Generic Reset Handler Helper
    const runReset = (sql, res) => {
        try {
            db.exec(sql);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    };

    // Full Factory Reset
    router.post('/factory-reset', authMiddleware, (req, res) => {
        try {
            db.exec('DELETE FROM channels; DELETE FROM categories; DELETE FROM epg_listings; DELETE FROM vod_active; DELETE FROM vod_categories; DELETE FROM series_active; DELETE FROM series_categories; DELETE FROM metadata_overrides; DELETE FROM watch_history; DELETE FROM settings; DELETE FROM profiles; DELETE FROM providers;');
            clearSessionCookie(res, req);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/reset/epg', authMiddleware, (req, res) => runReset('DELETE FROM epg_listings', res));
    router.post('/reset/metadata', authMiddleware, (req, res) => runReset('DELETE FROM metadata_overrides', res));
    router.post('/reset/history', authMiddleware, (req, res) => runReset('DELETE FROM watch_history', res));

    return router;
};
