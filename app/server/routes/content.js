const express = require('express');
const router = express.Router();

/**
 * MEDIA CONTENT ROUTES
 * Handles retrieval of live channels, VOD movies, TV series, and their respective categories.
 * Also manages user metadata (overrides) and watch progress (resume points).
 */
module.exports = (db, authMiddleware) => {

    // Get categories (Live TV)
    router.get('/categories', authMiddleware, (req, res) => {
        const { providerId } = req.query;
        let query = 'SELECT * FROM categories';
        const params = [];
        if (providerId) { query += ' WHERE provider_id = ?'; params.push(providerId); }
        query += ' ORDER BY name ASC';
        try {
            const stmt = db.prepare(query);
            res.json(stmt.all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get channels (Live TV)
    router.get('/channels', authMiddleware, (req, res) => {
        const { categoryId, providerId } = req.query;
        let query = `
            SELECT t.*, 
                   COALESCE(m.poster, t.stream_icon) as stream_icon,
                   m.logo as logo
            FROM channels t
            LEFT JOIN metadata_overrides m ON m.item_id = CAST(t.stream_id AS TEXT) AND m.type = 'channel'
            WHERE 1=1
        `;
        const params = [];
        if (providerId) { query += ' AND t.provider_id = ?'; params.push(providerId); }
        if (categoryId) { query += ' AND t.category_id = ?'; params.push(categoryId); }
        query += ' ORDER BY t.num ASC';
        try {
            const stmt = db.prepare(query);
            res.json(stmt.all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get VOD Categories (Movies or Series)
    router.get('/vod/categories', authMiddleware, (req, res) => {
        const { providerId, type } = req.query;
        const table = type === 'series' ? 'series_categories' : 'vod_categories';
        try {
            const stmt = db.prepare(`SELECT * FROM ${table} WHERE provider_id = ? ORDER BY name ASC`);
            res.json(stmt.all(providerId));
        } catch (err) { res.json([]); }
    });

    // Get VOD Items (Movies or Series)
    router.get('/vod/items', authMiddleware, (req, res) => {
        const { providerId, type, categoryId } = req.query;
        if (type !== 'series' && type !== 'movie') return res.json([]);
        const table = type === 'series' ? 'series_active' : 'vod_active';
        const idColumn = type === 'series' ? 'series_id' : 'stream_id';
        let query = `
            SELECT t.*, 
                   COALESCE(m.poster, ${type === 'series' ? 't.cover' : 't.stream_icon'}) as poster, 
                   m.backdrop as backdrop,
                   m.logo as logo
            FROM ${table} t
            LEFT JOIN metadata_overrides m ON m.item_id = CAST(t.${idColumn} AS TEXT) AND m.type = ?
            WHERE t.provider_id = ?
        `;
        const params = [type, providerId];
        if (categoryId) { query += ' AND t.category_id = ?'; params.push(categoryId); }
        try {
            const stmt = db.prepare(query);
            res.json(stmt.all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update Manual Metadata Overrides
    router.post('/metadata/update', authMiddleware, (req, res) => {
        const { itemId, type, poster, backdrop, logo } = req.body;
        try {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO metadata_overrides (item_id, type, poster, backdrop, logo)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(String(itemId), type, poster, backdrop, logo);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update Watch Progress
    router.post('/progress', authMiddleware, (req, res) => {
        const { streamId, type, parentId, name, poster, time, duration } = req.body;
        const userId = req.user?.username;
        if (!userId || !streamId) return res.status(400).send("Missing IDs");
        
        try {
            if (duration > 0 && time > (duration * 0.95)) {
                db.prepare('DELETE FROM watch_history WHERE user_id = ? AND stream_id = ?').run(userId, String(streamId));
                return res.json({ success: true, status: 'completed' });
            }
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO watch_history (user_id, stream_id, type, parent_id, name, poster, resume_time, duration, last_watched)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(userId, String(streamId), type || 'movie', parentId || null, name || 'Unknown Title', poster || '', Math.floor(time), Math.floor(duration), new Date().toISOString());
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get Progress for a specific stream
    router.get('/progress/:userId/:streamId', authMiddleware, (req, res) => {
        const { streamId } = req.params;
        const userId = req.user?.username;
        try {
            const stmt = db.prepare('SELECT * FROM watch_history WHERE user_id = ? AND stream_id = ?');
            const data = stmt.get(userId, streamId);
            res.json(data || { resume_time: 0 });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get "Continue Watching" List
    router.get('/progress/list/:userId/:type', authMiddleware, (req, res) => {
        const { type } = req.params;
        const userId = req.user?.username;
        try {
            const stmt = db.prepare('SELECT * FROM watch_history WHERE user_id = ? AND type = ? ORDER BY last_watched DESC LIMIT 20');
            const data = stmt.all(userId, type);
            res.json(data);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Global Search
    router.get('/search', authMiddleware, (req, res) => {
        const { q, providerId } = req.query;
        if (!q) return res.json({ channels: [], movies: [], series: [], total: 0 });

        const searchPattern = `%${q}%`;
        try {
            const channels = db.prepare(`SELECT * FROM channels WHERE (name LIKE ? OR stream_id LIKE ?) ${providerId ? 'AND provider_id = ?' : ''} LIMIT 50`).all(...(providerId ? [searchPattern, searchPattern, providerId] : [searchPattern, searchPattern]));
            const movies = db.prepare(`SELECT * FROM vod_active WHERE (name LIKE ? OR stream_id LIKE ?) ${providerId ? 'AND provider_id = ?' : ''} LIMIT 50`).all(...(providerId ? [searchPattern, searchPattern, providerId] : [searchPattern, searchPattern]));
            const series = db.prepare(`SELECT * FROM series_active WHERE (name LIKE ? OR series_id LIKE ?) ${providerId ? 'AND provider_id = ?' : ''} LIMIT 50`).all(...(providerId ? [searchPattern, searchPattern, providerId] : [searchPattern, searchPattern]));

            res.json({
                channels,
                movies,
                series,
                total: channels.length + movies.length + series.length
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============================================================
    // FAVORITES SYSTEM
    // ============================================================

    // Toggle favorite (add if missing, remove if exists)
    router.post('/favorites/toggle', authMiddleware, (req, res) => {
        const { itemId, itemType, name, poster, providerId } = req.body;
        const userId = req.user?.username;
        if (!userId || !itemId || !itemType) return res.status(400).json({ error: 'Missing required fields' });

        try {
            const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?').get(userId, String(itemId), itemType);
            if (existing) {
                db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
                res.json({ favorited: false });
            } else {
                db.prepare('INSERT INTO favorites (user_id, item_id, item_type, name, poster, provider_id) VALUES (?, ?, ?, ?, ?, ?)').run(userId, String(itemId), itemType, name || null, poster || null, providerId || null);
                res.json({ favorited: true });
            }
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get all favorites for the current user (optionally filter by type)
    router.get('/favorites', authMiddleware, (req, res) => {
        const userId = req.user?.username;
        const { type, providerId } = req.query;
        if (!userId) return res.json([]);

        try {
            let query = 'SELECT * FROM favorites WHERE user_id = ?';
            const params = [userId];
            if (type) { query += ' AND item_type = ?'; params.push(type); }
            if (providerId) { query += ' AND provider_id = ?'; params.push(providerId); }
            query += ' ORDER BY created_at DESC';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Check if a specific item is favorited
    router.get('/favorites/check', authMiddleware, (req, res) => {
        const userId = req.user?.username;
        const { itemId, itemType } = req.query;
        if (!userId || !itemId || !itemType) return res.json({ favorited: false });

        const row = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?').get(userId, String(itemId), itemType);
        res.json({ favorited: !!row });
    });

    // ============================================================
    // RECENT CHANNELS
    // ============================================================

    // Record a channel view (upsert)
    router.post('/recent-channels', authMiddleware, (req, res) => {
        const { streamId, name, streamIcon, providerId } = req.body;
        const userId = req.user?.username;
        if (!userId || !streamId) return res.status(400).json({ error: 'Missing fields' });

        try {
            db.prepare(`
                INSERT INTO recent_channels (user_id, stream_id, name, stream_icon, provider_id, last_watched)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(user_id, stream_id)
                DO UPDATE SET name = excluded.name, stream_icon = excluded.stream_icon, last_watched = datetime('now')
            `).run(userId, streamId, name || null, streamIcon || null, providerId || null);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get recent channels (last 20)
    router.get('/recent-channels', authMiddleware, (req, res) => {
        const userId = req.user?.username;
        const { providerId } = req.query;
        if (!userId) return res.json([]);

        try {
            let query = 'SELECT * FROM recent_channels WHERE user_id = ?';
            const params = [userId];
            if (providerId) { query += ' AND provider_id = ?'; params.push(providerId); }
            query += ' ORDER BY last_watched DESC LIMIT 20';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============================================================
    // CONTINUE WATCHING
    // ============================================================

    router.get('/continue-watching', authMiddleware, (req, res) => {
        const userId = req.user?.username;
        const { type } = req.query; // 'movie' or 'series'
        if (!userId) return res.json([]);

        try {
            let query = `SELECT * FROM watch_history WHERE user_id = ? AND resume_time > 30 AND (duration IS NULL OR resume_time < duration - 60)`;
            const params = [userId];
            if (type) { query += ' AND type = ?'; params.push(type); }
            query += ' ORDER BY last_watched DESC LIMIT 20';
            res.json(db.prepare(query).all(...params));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============================================================
    // METADATA SCAN TRIGGER
    // ============================================================

    router.post('/metadata/scan', authMiddleware, async (req, res) => {
        try {
            const { scanLibrary } = require('../metadata');
            const result = await scanLibrary(db);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
