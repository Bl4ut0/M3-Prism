const express = require('express');
const router = express.Router();
const axios = require('axios');
const { syncData } = require('../sync');
const { importM3U } = require('../m3uParser');

/**
 * PROVIDER & SYNC ROUTES (ACCESSIBILITY FIX)
 */
module.exports = (db, authMiddleware, setupMiddleware, registerEPGSync, getCachedEPG, getCachedEPGBatch, getEPGSyncStatus, decryptSecret) => {

    // --- Provider Management (UNLOCKED for Login screen) ---
    router.get(['/providers', '/provider'], (req, res) => {
        try {
            const stmt = db.prepare('SELECT * FROM providers');
            res.json(stmt.all());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post(['/providers/test', '/provider/test'], async (req, res) => {
        const { url, username, password } = req.body;
        try {
            const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            const response = await axios.get(`${baseUrl}/player_api.php`, {
                params: { username, password },
                timeout: 10000
            });
            if (String(response.data?.user_info?.auth) === '1') {
                res.json({ success: true, user_info: response.data.user_info });
            } else {
                res.status(401).json({ success: false, error: 'Invalid credentials' });
            }
        } catch (err) {
            const status = err.response?.status === 401 ? 401 : 502;
            res.status(status).json({ success: false, error: status === 401 ? 'Invalid credentials' : 'Provider connection failed' });
        }
    });

    // Administrative routes remain protected by setupMiddleware or authMiddleware
    router.post(['/providers', '/provider'], setupMiddleware, (req, res) => {
        const { name, url, type } = req.body;
        const id = `provider_${Date.now()}`;
        try {
            const stmt = db.prepare('INSERT INTO providers (id, name, url, type) VALUES (?, ?, ?, ?)');
            stmt.run(id, name, url, type || 'xtream');
            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put(['/providers/:id', '/provider/:id'], setupMiddleware, (req, res) => {
        const { id } = req.params;
        const { name, url, type } = req.body;
        try {
            db.prepare('UPDATE providers SET name = ?, url = ?, type = ? WHERE id = ?').run(name, url, type || 'xtream', id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete(['/providers/:id', '/provider/:id'], setupMiddleware, (req, res) => {
        try {
            db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put(['/providers/:id/timeshift', '/provider/:id/timeshift'], authMiddleware, (req, res) => {
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

    // --- Sync & EPG ---
    router.post('/sync/all', authMiddleware, async (req, res) => {
        const { providerId, user: incomingUser } = req.body;
        if (!providerId) return res.status(400).json({ error: 'Missing providerId' });
        
        const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
        if (!provider) return res.status(404).json({ error: 'Provider not found' });

        let syncUser = incomingUser;
        if ((!syncUser || !syncUser.password)) {
            let profile;
            if (req.user?.profileId) {
                profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user.profileId);
            } else {
                profile = db.prepare('SELECT * FROM profiles WHERE provider_id = ? AND is_active = 1 LIMIT 1').get(providerId);
                if (!profile) profile = db.prepare('SELECT * FROM profiles WHERE provider_id = ? LIMIT 1').get(providerId);
            }

            if (profile) {
                syncUser = { 
                    username: profile.username, 
                    password: profile.password ? decryptSecret(profile.password) : null 
                };
            }
        }

        if (!syncUser || !syncUser.username || !syncUser.password) {
            return res.status(401).json({ error: 'Sync failed: No credentials found in profile vault' });
        }
        
        const result = await syncData(db, provider, syncUser);
        res.json(result);
    });

    router.post('/epg/register', authMiddleware, async (req, res) => {
        const { providerId, user: incomingUser } = req.body;
        let syncUser = incomingUser;
        if ((!syncUser || !syncUser.password)) {
            const profile = db.prepare('SELECT * FROM profiles WHERE provider_id = ? ORDER BY is_active DESC LIMIT 1').get(providerId);
            if (profile) {
                syncUser = { 
                    username: profile.username, 
                    password: profile.password ? decryptSecret(profile.password) : null 
                };
            }
        }

        if (!providerId || !syncUser || !syncUser.username || !syncUser.password) {
            return res.status(400).json({ error: 'Missing vault credentials for EPG sync' });
        }
        try {
            await registerEPGSync(db, providerId, syncUser);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/epg/:streamId', authMiddleware, (req, res) => {
        const { streamId } = req.params;
        const { providerId } = req.query;
        const listings = getCachedEPG(db, parseInt(streamId, 10), providerId);
        res.json({ epg_listings: listings });
    });

    router.post('/epg/batch', authMiddleware, (req, res) => {
        const { streamIds, providerId } = req.body;
        const grouped = getCachedEPGBatch(db, streamIds.map(id => parseInt(id, 10)), providerId);
        res.json(grouped);
    });

    router.get('/epg/status', authMiddleware, (req, res) => {
        res.json(getEPGSyncStatus());
    });

    return router;
};
