const jwt = require('jsonwebtoken');
const { get } = require('./httpClient');
const { encryptSecret, JWT_SECRET } = require('./cryptoUtils');

const COOKIE_NAME = 'm3prism_session';

function isSavedProfileLoginEnabled() {
    return process.env.M3PRISM_DESKTOP === 'true' || process.env.WEBPLAYER_ALLOW_SAVED_PROFILE_LOGIN === 'true';
}

function shouldUseSecureCookies(req) {
    if (process.env.WEBPLAYER_SECURE_COOKIE === 'true') return true;
    if (process.env.WEBPLAYER_SECURE_COOKIE === 'false') return false;
    return req?.secure || req?.headers['x-forwarded-proto'] === 'https';
}

function getCookieOptions(req) {
    return {
        httpOnly: true,
        secure: shouldUseSecureCookies(req),
        sameSite: 'Strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, 
    };
}

function getSessionFromRequest(req) {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

function setSessionCookie(res, payload, req) {
    const sessionPayload = { ...payload };
    const token = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: '30d' });
    res.cookie(COOKIE_NAME, token, getCookieOptions(req));
}

function clearSessionCookie(res, req) {
    res.clearCookie(COOKIE_NAME, getCookieOptions(req));
}

const getActiveProfile = (db) => {
    return db.prepare('SELECT * FROM profiles WHERE is_active = 1').get();
};

const isConfigured = (db) => {
    const profiles = db.prepare('SELECT COUNT(*) as count FROM profiles').get();
    const providers = db.prepare('SELECT COUNT(*) as count FROM providers').get();
    return profiles.count > 0 || providers.count > 0;
};

const authMiddleware = (db) => (req, res, next) => {
    let decoded = getSessionFromRequest(req);
    const currentFingerprint = req.headers['x-device-id'] || req.query.device_id;

    if (!decoded && isSavedProfileLoginEnabled()) {
        const activeProfile = getActiveProfile(db);
        if (activeProfile) {
            const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(activeProfile.provider_id);
            if (provider) {
                console.info(`[Auth] 🚀 Seamless Session Revive: Welcome back, ${activeProfile.name}`);
                decoded = {
                    username: activeProfile.username,
                    providerId: provider.id,
                    profileId: activeProfile.id,
                    serverUrl: provider.url,
                    deviceId: currentFingerprint 
                };
                setSessionCookie(res, decoded, req);
            }
        }
    }

    if (!decoded) {
        if (!isConfigured(db)) return next();
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (decoded.deviceId && currentFingerprint && decoded.deviceId !== currentFingerprint) {
        console.warn(`[Security] Session access from different device blocked.`);
        res.clearCookie(COOKIE_NAME);
        return res.status(401).json({ error: 'Session bound to different hardware.' });
    }

    req.user = decoded;
    next();
};

const setupAuthRoutes = (app, db) => {
    const authPrefixes = ['/api/auth', '/auth'];

    authPrefixes.forEach(prefix => {
        app.get(`${prefix}/me`, authMiddleware, (req, res) => {
            const profile = db.prepare(`
                SELECT id, name, type, provider_id, username, user_agent, timeshift, is_active, last_used, created_at
                FROM profiles WHERE id = ?
            `).get(req.user.profileId);
            const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.user.providerId);
            if (!profile || !provider) {
                clearSessionCookie(res, req);
                return res.status(401).json({ error: 'Session profile is no longer available' });
            }
            res.json({
                user: { username: req.user.username, auth: 1 },
                provider,
                profile,
                sessionType: req.user.sessionType || 'xtream',
                profileId: req.user.profileId
            });
        });

        app.post(`${prefix}/login`, async (req, res) => {
            const { providerId, username, password, profileName } = req.body;
            if (!providerId || !username || !password) return res.status(400).json({ error: 'Missing required fields' });

            try {
                const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
                if (!provider) return res.status(404).json({ error: 'Provider not found' });

                const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;
                const targetUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
                const response = await get(targetUrl, { timeout: 10000 });

                if (response.data && response.data.user_info && String(response.data.user_info.auth) === '1') {
                    
                    // SMART RECOVERY: Find existing profile for this user/provider
                    let profile = db.prepare('SELECT * FROM profiles WHERE provider_id = ? AND username = ?').get(providerId, username);
                    
                    // FALLBACK: If we missed it (e.g. from previous naming bug), look for orphaned profiles with this username
                    if (!profile) {
                        profile = db.prepare('SELECT * FROM profiles WHERE provider_id IS NULL AND username = ?').get(username);
                        if (profile) {
                            console.log(`[Auth] 🛠️ Adopting orphaned profile: ${profile.name} for provider ${providerId}`);
                            db.prepare('UPDATE profiles SET provider_id = ? WHERE id = ?').run(providerId, profile.id);
                        }
                    }

                    if (!profile) {
                        const profileId = `profile_${Date.now()}`;
                        db.transaction(() => {
                            db.prepare('UPDATE profiles SET is_active = 0').run();
                            db.prepare('INSERT INTO profiles (id, name, type, provider_id, username, password, is_active, last_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                                profileId,
                                typeof profileName === 'string' && profileName.trim() ? profileName.trim() : username,
                                provider.type || 'xtream',
                                provider.id,
                                username,
                                encryptSecret(password),
                                1,
                                new Date().toISOString(),
                                new Date().toISOString()
                            );
                        })();
                        profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
                    } else {
                        db.transaction(() => {
                            db.prepare('UPDATE profiles SET is_active = 0').run();
                            db.prepare(`
                                UPDATE profiles
                                SET name = ?, type = ?, password = ?, is_active = 1, last_used = ?
                                WHERE id = ?
                            `).run(
                                typeof profileName === 'string' && profileName.trim() ? profileName.trim() : profile.name,
                                provider.type || profile.type || 'xtream',
                                encryptSecret(password),
                                new Date().toISOString(),
                                profile.id
                            );
                        })();
                        profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id);
                    }

                    const tokenPayload = {
                        username,
                        providerId,
                        serverUrl: baseUrl,
                        profileId: profile.id,
                        sessionType: provider.type || 'xtream',
                        userInfo: { ...response.data.user_info, password: '' },
                        deviceId: req.headers['x-device-id'] || req.query.device_id
                    };
                    setSessionCookie(res, tokenPayload, req);
                    return res.json({ 
                        success: true, 
                        user_info: tokenPayload.userInfo, 
                        provider,
                        profile: {
                            id: profile.id,
                            name: profile.name,
                            type: profile.type,
                            provider_id: profile.provider_id,
                            username: profile.username,
                            user_agent: profile.user_agent,
                            timeshift: profile.timeshift,
                            is_active: profile.is_active,
                            last_used: profile.last_used,
                        }
                    });
                } else {
                    return res.status(401).json({ error: 'Invalid Credentials with IPTV Provider' });
                }
            } catch (error) {
                console.error('Login backend error:', error.message);
                const status = error.response?.status === 401 ? 401 : 502;
                return res.status(status).json({ error: status === 401 ? 'Invalid Credentials with IPTV Provider' : 'Authentication request failed' });
            }
        });

        app.post(`${prefix}/logout`, (req, res) => {
            clearSessionCookie(res, req);
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });
};

module.exports = {
    authMiddleware,
    clearSessionCookie,
    COOKIE_NAME,
    getSessionFromRequest,
    isSavedProfileLoginEnabled,
    setSessionCookie,
    setupAuthRoutes,
    JWT_SECRET
};
