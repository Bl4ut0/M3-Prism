const { get } = require('./httpClient');
const path = require('path');

const syncData = async (db, provider, user) => {
    if (!provider || !user || !user.username || !user.password) {
        console.warn(`[Sync] Skipping ${provider?.name || 'Unknown'}: Missing credentials.`);
        return { success: false, error: 'Missing credentials' };
    }

    const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;
    const baseParams = {
        username: user.username,
        password: user.password
    };

    // Use provider-specific User-Agent if defined, otherwise fallback to global
    const axiosConfig = {
        timeout: 30000,
        headers: provider.userAgent ? { 'User-Agent': provider.userAgent } : {}
    };

    console.log(`[Sync] Starting full sync for provider: ${provider.name} (UA: ${provider.userAgent || 'Default'})`);

    try {
        // --- LIVE TV ---
        try {
            const catRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                params: { ...baseParams, action: 'get_live_categories' }
            });

            if (catRes.data && Array.isArray(catRes.data)) {
                const insertCat = db.prepare('INSERT OR REPLACE INTO categories (id, name, provider_id) VALUES (?, ?, ?)');
                db.transaction(() => {
                    db.prepare('DELETE FROM categories WHERE provider_id = ?').run(provider.id);
                    for (const cat of catRes.data) {
                        insertCat.run(cat.category_id, cat.category_name, provider.id);
                    }
                })();
                console.log(`[Sync] Live Categories updated: ${catRes.data.length}`);
            }

            const chanRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                timeout: 60000, // Channels can be HUGE
                params: { ...baseParams, action: 'get_live_streams' }
            });

            if (chanRes.data && Array.isArray(chanRes.data)) {
                const insertChan = db.prepare(`
                    INSERT OR REPLACE INTO channels (
                        stream_id, name, stream_icon, category_id, num, epg_channel_id, provider_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    db.prepare('DELETE FROM channels WHERE provider_id = ?').run(provider.id);
                    for (const ch of chanRes.data) {
                        insertChan.run(
                            ch.stream_id,
                            ch.name,
                            ch.stream_icon || ch.cover || ch.thumb,
                            ch.category_id,
                            ch.num,
                            ch.epg_channel_id,
                            provider.id
                        );
                    }
                })();
                console.log(`[Sync] Live Channels updated: ${chanRes.data.length}`);
            }
        } catch (e) {
            console.error(`[Sync] Live TV sync failed for ${provider.name}:`, e.message);
        }

        // --- MOVIES (VOD) ---
        try {
            const vodCatRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                params: { ...baseParams, action: 'get_vod_categories' }
            });

            if (vodCatRes.data && Array.isArray(vodCatRes.data)) {
                const insertVodCat = db.prepare('INSERT OR REPLACE INTO vod_categories (id, name, provider_id) VALUES (?, ?, ?)');
                db.transaction(() => {
                    db.prepare('DELETE FROM vod_categories WHERE provider_id = ?').run(provider.id);
                    for (const cat of vodCatRes.data) {
                        insertVodCat.run(cat.category_id, cat.category_name, provider.id);
                    }
                })();
            }

            const vodRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                timeout: 60000,
                params: { ...baseParams, action: 'get_vod_streams' }
            });

            if (vodRes.data && Array.isArray(vodRes.data)) {
                const insertVod = db.prepare(`
                    INSERT OR REPLACE INTO vod_active (
                        stream_id, name, stream_icon, category_id, container_extension, rating, provider_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    db.prepare('DELETE FROM vod_active WHERE provider_id = ?').run(provider.id);
                    for (const m of vodRes.data) {
                        insertVod.run(m.stream_id, m.name, m.stream_icon, m.category_id, m.container_extension, m.rating || '', provider.id);
                    }
                })();
                console.log(`[Sync] Movies updated: ${vodRes.data.length}`);
            }
        } catch (e) {
            console.warn(`[Sync] VOD sync failed (skipping):`, e.message);
        }

        // --- SERIES ---
        try {
            const serCatRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                params: { ...baseParams, action: 'get_series_categories' }
            });

            if (serCatRes.data && Array.isArray(serCatRes.data)) {
                const insertSerCat = db.prepare('INSERT OR REPLACE INTO series_categories (id, name, provider_id) VALUES (?, ?, ?)');
                db.transaction(() => {
                    db.prepare('DELETE FROM series_categories WHERE provider_id = ?').run(provider.id);
                    for (const cat of serCatRes.data) {
                        insertSerCat.run(cat.category_id, cat.category_name, provider.id);
                    }
                })();
            }

            const serRes = await get(`${baseUrl}/player_api.php`, {
                ...axiosConfig,
                timeout: 60000,
                params: { ...baseParams, action: 'get_series' }
            });

            if (serRes.data && Array.isArray(serRes.data)) {
                const insertSer = db.prepare(`
                    INSERT OR REPLACE INTO series_active (
                        series_id, name, cover, category_id, rating, provider_id
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `);
                db.transaction(() => {
                    db.prepare('DELETE FROM series_active WHERE provider_id = ?').run(provider.id);
                    for (const s of serRes.data) {
                        insertSer.run(s.series_id, s.name, s.cover, s.category_id, s.rating || '', provider.id);
                    }
                })();
                console.log(`[Sync] Series updated: ${serRes.data.length}`);
            }
        } catch (e) {
            console.warn(`[Sync] Series sync failed (skipping):`, e.message);
        }

        // 7. Mark last sync time
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .run('last_sync_time', JSON.stringify(new Date().toISOString()));

        // Trigger background metadata scan
        const { startBackgroundScan } = require('./metadata');
        startBackgroundScan(db).catch(err => console.error("Background scan failed to start:", err));

        return { success: true };
    } catch (err) {
        console.error('[Sync] Fatal error during sync:', err.message);
        return { success: false, error: err.message };
    }
};

const syncEPG = async (db, provider, user, streamId) => {
    const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;
    const axiosConfig = {
        timeout: 10000,
        headers: provider.userAgent ? { 'User-Agent': provider.userAgent } : {}
    };

    try {
        const res = await get(`${baseUrl}/player_api.php`, {
            ...axiosConfig,
            params: {
                username: user.username,
                password: user.password,
                action: 'get_short_epg',
                stream_id: streamId
            }
        });

        if (res.data && res.data.epg_listings) {
            const insertEPG = db.prepare(`
                INSERT OR REPLACE INTO epg_listings (
                    id, stream_id, provider_id, title, description, start_time, stop_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            db.transaction(() => {
                for (const prog of res.data.epg_listings) {
                    const uniqueId = `${provider.id}_${streamId}_${prog.start}`;
                    insertEPG.run(
                        uniqueId,
                        streamId,
                        provider.id,
                        prog.title,
                        prog.description,
                        prog.start,
                        prog.stop
                    );
                }
            })();
            return { success: true, listings: res.data.epg_listings };
        }
        return { success: false, error: 'No EPG data returned' };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

module.exports = { syncData, syncEPG };
