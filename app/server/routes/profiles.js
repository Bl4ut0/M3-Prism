const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { get } = require('../httpClient');

/**
 * PROFILE & ACCOUNT ROUTES (SMART DELETION)
 */
module.exports = (db, authMiddleware, setupMiddleware, JWT_SECRET, decryptSecret, encryptSecret, setSessionCookie, clearSessionCookie, isSavedProfileLoginEnabled) => {

    const publicProfileColumns = 'id, name, type, provider_id, username, user_agent, timeshift, is_active, last_used, created_at';
    const getPublicProfile = (id) => db.prepare(`SELECT ${publicProfileColumns} FROM profiles WHERE id = ?`).get(id);
    const normalizeTimeshift = (value) => Number.isFinite(Number(value)) ? Math.max(-12, Math.min(12, Number(value))) : 0;

    // --- Profile Management ---
    
    router.post(['/profiles', '/profile'], setupMiddleware, (req, res) => {
        const { name, type, provider_id, providerId, username, password, m3u_url, m3uUrl, user_agent, timeshift } = req.body;
        const targetProviderId = providerId || provider_id;
        const normalizedType = type === 'm3u' ? 'm3u' : 'xtream';
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!normalizedName || !targetProviderId) {
            return res.status(400).json({ error: 'Profile name and provider are required' });
        }
        if (normalizedType === 'xtream' && (!username || !password)) {
            return res.status(400).json({ error: 'Username and password are required for Xtream profiles' });
        }
        if (!db.prepare('SELECT id FROM providers WHERE id = ?').get(targetProviderId)) {
            return res.status(404).json({ error: 'Provider not found' });
        }
        const id = `profile_${randomUUID()}`;
        try {
            const stmt = db.prepare(`
                INSERT INTO profiles (id, name, type, provider_id, username, password, m3u_url, user_agent, timeshift, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(id, normalizedName, normalizedType, targetProviderId, username || null, password ? encryptSecret(password) : null, m3u_url || m3uUrl || null, user_agent || null, normalizeTimeshift(timeshift), new Date().toISOString());
            res.status(201).json({ success: true, id, profile: getPublicProfile(id) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put(['/profiles/:id', '/profile/:id'], authMiddleware, (req, res) => {
        const { id } = req.params;
        const { name, user_agent, timeshift } = req.body;
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!normalizedName) return res.status(400).json({ error: 'Profile name is required' });
        try {
            const result = db.prepare('UPDATE profiles SET name = ?, user_agent = ?, timeshift = ? WHERE id = ?').run(normalizedName, user_agent || null, normalizeTimeshift(timeshift), id);
            if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });
            res.json({ success: true, profile: getPublicProfile(id) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put(['/profiles/:id/activate', '/profile/:id/activate'], authMiddleware, (req, res) => {
        const { id } = req.params;
        try {
            db.transaction(() => {
                db.prepare('UPDATE profiles SET is_active = 0').run();
                const result = db.prepare('UPDATE profiles SET is_active = 1, last_used = ? WHERE id = ?').run(new Date().toISOString(), id);
                if (result.changes === 0) throw new Error('Profile not found');
            })();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // SMART DELETE: Logout if deleting active profile
    router.delete(['/profiles/:id', '/profile/:id'], authMiddleware, (req, res) => {
        const { id } = req.params;
        try {
            db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
            
            // If the user deleted their own active profile, clear the session
            if (req.user && req.user.profileId === id) {
                console.log(`[Auth] Active profile ${id} deleted. Clearing session.`);
                clearSessionCookie(res, req);
            }
            
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get(['/profiles', '/profile'], (req, res, next) => {
        if (isSavedProfileLoginEnabled()) return next();
        return authMiddleware(req, res, next);
    }, (req, res) => {
        try {
            res.json(db.prepare(`SELECT ${publicProfileColumns} FROM profiles ORDER BY is_active DESC, last_used DESC, created_at ASC`).all());
        } catch (err) { res.status(200).json([]); }
    });

    // --- Authentication Flow ---

    router.post(['/profiles/:id/login', '/profile/:id/login'], async (req, res) => {
        const { id } = req.params;
        try {
            const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
            if (!profile) return res.status(404).json({ error: 'Profile not found' });
            const profileState = db.prepare('SELECT COUNT(*) AS count, SUM(is_active) AS activeCount FROM profiles').get();
            const isInitialProfileActivation = profileState.count === 1 && !profileState.activeCount;
            if (!isSavedProfileLoginEnabled() && !isInitialProfileActivation) {
                return res.status(403).json({ error: 'Saved-profile login is disabled in web-service mode. Sign in with provider credentials instead.' });
            }
            
            const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(profile.provider_id);
            if (!provider) return res.status(404).json({ error: 'Provider not found' });

            const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;

            if (profile.type === 'm3u' || provider.type === 'm3u') {
                const lastUsed = new Date().toISOString();
                db.transaction(() => {
                    db.prepare('UPDATE profiles SET is_active = 0').run();
                    db.prepare('UPDATE profiles SET is_active = 1, last_used = ? WHERE id = ?').run(lastUsed, id);
                })();
                const userInfo = { username: profile.username || profile.name, auth: 1, status: 'Active' };
                setSessionCookie(res, {
                    username: userInfo.username,
                    providerId: provider.id,
                    serverUrl: baseUrl,
                    profileId: profile.id,
                    sessionType: 'm3u',
                    userInfo,
                }, req);
                return res.json({ success: true, user_info: userInfo, provider, profile: getPublicProfile(id) });
            }

            const password = profile.password ? decryptSecret(profile.password) : null;
            if (!profile.username || !password) return res.status(409).json({ error: 'Saved profile credentials are unavailable' });

            const response = await get(`${baseUrl}/player_api.php`, {
                params: { username: profile.username, password },
                timeout: 10000
            });

            if (String(response.data?.user_info?.auth) === '1') {
                const lastUsed = new Date().toISOString();
                db.transaction(() => {
                    db.prepare('UPDATE profiles SET is_active = 0').run();
                    db.prepare('UPDATE profiles SET is_active = 1, last_used = ? WHERE id = ?').run(lastUsed, id);
                })();
                setSessionCookie(res, {
                    username: profile.username,
                    providerId: provider.id,
                    serverUrl: baseUrl,
                    profileId: profile.id,
                    userInfo: response.data.user_info
                }, req);
                res.json({ success: true, user_info: { ...response.data.user_info, password: '' }, provider, profile: getPublicProfile(id) });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } catch (err) {
            const status = err.response?.status === 401 ? 401 : 502;
            res.status(status).json({ error: status === 401 ? 'Saved credentials are invalid' : 'Provider authentication failed' });
        }
    });

    return router;
};
