const { get } = require('./httpClient');
const { decryptSecret, encryptSecret } = require('./cryptoUtils');

// --- Configuration ---
const EPG_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DELAY_BETWEEN_CHANNELS_MS = 250; // 250ms between requests to avoid rate-limiting
const REQUEST_TIMEOUT_MS = 8000;
const BATCH_SIZE = 50; // Process channels in batches, with a longer pause between batches
const BATCH_PAUSE_MS = 2000; // 2s pause between batches

let syncTimer = null;
let isSyncing = false;
let lastSyncStats = { startedAt: null, completedAt: null, channelsProcessed: 0, listingsStored: 0, errors: 0 };

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch EPG for a single channel and store it in the database.
 * Returns the number of listings stored.
 */
const fetchAndStoreChannelEPG = async (db, channel, providerUrl, user, providerId) => {
    const baseUrl = providerUrl.endsWith('/') ? providerUrl.slice(0, -1) : providerUrl;

    try {
        const res = await get(`${baseUrl}/player_api.php`, {
            params: {
                username: user.username,
                password: user.password,
                action: 'get_short_epg',
                stream_id: channel.stream_id
            },
            timeout: REQUEST_TIMEOUT_MS
        });

        if (res.data && res.data.epg_listings && Array.isArray(res.data.epg_listings)) {
            const listings = res.data.epg_listings;
            if (listings.length === 0) return 0;

            const insertEPG = db.prepare(`
                INSERT OR REPLACE INTO epg_listings (
                    id, stream_id, provider_id, title, description, start_time, stop_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            db.transaction(() => {
                for (const prog of listings) {
                    const uniqueId = `${providerId}_${channel.stream_id}_${prog.start}`;
                    insertEPG.run(
                        uniqueId,
                        channel.stream_id,
                        providerId,
                        prog.title,
                        prog.description,
                        prog.start,
                        prog.stop
                    );
                }
            })();

            return listings.length;
        }

        return 0;
    } catch (err) {
        // Silently skip individual channel failures (timeouts, 404s, etc.)
        return -1;
    }
};

/**
 * Run a full EPG sync for all channels in the database.
 * Fetches EPG data for each channel sequentially with delays to avoid rate-limiting.
 */
const runEPGSync = async (db) => {
    if (isSyncing) {
        console.log('[EPG Sync] Already in progress, skipping.');
        return lastSyncStats;
    }

    // Retrieve stored credentials
    const credsRow = db.prepare("SELECT value FROM settings WHERE key = 'epg_sync_credentials'").get();
    if (!credsRow) {
        console.log('[EPG Sync] No credentials stored. Skipping sync.');
        return lastSyncStats;
    }

    let credsList;
    try {
        credsList = JSON.parse(credsRow.value);
    } catch (e) {
        console.error('[EPG Sync] Failed to parse stored credentials:', e.message);
        return lastSyncStats;
    }

    isSyncing = true;
    lastSyncStats = { startedAt: new Date().toISOString(), completedAt: null, channelsProcessed: 0, listingsStored: 0, errors: 0 };

    console.log('[EPG Sync] Starting background EPG sync...');

    try {
        for (const creds of credsList) {
            const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(creds.providerId);
            if (!provider) {
                console.log(`[EPG Sync] Provider ${creds.providerId} not found, skipping.`);
                continue;
            }

            if (!creds.user || !creds.user.username) {
                console.log(`[EPG Sync] Skipping ${provider.name}: No authenticated profile found.`);
                continue;
            }
            const storedPassword = creds.user.passwordEncrypted
                ? decryptSecret(creds.user.passwordEncrypted)
                : creds.user.password;
            if (!storedPassword) {
                console.log(`[EPG Sync] Skipping ${provider.name}: Stored credentials could not be decrypted.`);
                continue;
            }

            // Clean up old EPG data (listings older than 24 hours ago) for this provider
            const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
            try {
                const deleted = db.prepare("DELETE FROM epg_listings WHERE stop_time < ? AND provider_id = ?").run(cutoffDate, provider.id);
                if (deleted.changes > 0) {
                    console.log(`[EPG Sync] Cleaned up ${deleted.changes} expired EPG listings for provider "${provider.name}".`);
                }
            } catch (e) {
                // Non-critical, some stop_time formats may not be comparable. Move on.
            }

            // Map EPG IDs to Stream IDs
            const channels = db.prepare('SELECT stream_id, epg_channel_id FROM channels WHERE provider_id = ?').all(provider.id);
            const epgMap = {};
            for (const ch of channels) {
                const epgId = ch.epg_channel_id || ch.stream_id.toString(); 
                if (!epgMap[epgId]) epgMap[epgId] = [];
                epgMap[epgId].push(ch.stream_id);
            }

            console.log(`[EPG Sync] Downloading full XMLTV payload for provider "${provider.name}"...`);
            const baseUrl = provider.url.endsWith('/') ? provider.url.slice(0, -1) : provider.url;
            
            try {
                const res = await get(`${baseUrl}/xmltv.php`, {
                    params: { username: creds.user.username, password: storedPassword },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 60000, // Extended timeout for large XML file
                    headers: provider.userAgent ? { 'User-Agent': provider.userAgent } : {}
                });

                console.log(`[EPG Sync] Parsing XML data...`);
                const { XMLParser } = require('fast-xml-parser');
                const parser = new XMLParser({ 
                    ignoreAttributes: false, 
                    attributeNamePrefix: "",
                    processEntities: false // Required to bypass 1000 limit for 100MB+ XMLTV files
                });
                const xmlObj = parser.parse(res.data);

                if (xmlObj && xmlObj.tv && xmlObj.tv.programme) {
                    let programmes = xmlObj.tv.programme;
                    if (!Array.isArray(programmes)) programmes = [programmes];

                    console.log(`[EPG Sync] Inserting ${programmes.length} listings into database...`);

                    const insertEPG = db.prepare(`
                        INSERT OR REPLACE INTO epg_listings (
                            id, stream_id, provider_id, title, description, start_time, stop_time
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `);

                    // 20260414000000 +0000 -> 2026-04-14 00:00:00
                    const formatXmlDate = (dStr) => {
                        if (!dStr || dStr.length < 14) return null;
                        return `${dStr.substring(0,4)}-${dStr.substring(4,6)}-${dStr.substring(6,8)} ${dStr.substring(8,10)}:${dStr.substring(10,12)}:${dStr.substring(12,14)}`;
                    };

                    let insertCount = 0;
                    const CHUNK_SIZE = 500;
                    
                    for (let i = 0; i < programmes.length; i += CHUNK_SIZE) {
                        const chunk = programmes.slice(i, i + CHUNK_SIZE);
                        
                        db.transaction(() => {
                            for (const p of chunk) {
                                const epgChanId = p.channel;
                                if (!epgChanId || !epgMap[epgChanId]) continue;

                                const title = typeof p.title === 'string' ? p.title : (p.title?.['#text'] || '');
                                const desc = typeof p.desc === 'string' ? p.desc : (p.desc?.['#text'] || '');
                                const startTime = formatXmlDate(p.start) || null;
                                const stopTime = formatXmlDate(p.stop) || null;

                                for (const streamId of epgMap[epgChanId]) {
                                    const uniqueId = `${provider.id}_${streamId}_${p.start}`;
                                    insertEPG.run(uniqueId, streamId, provider.id, title, desc, startTime, stopTime);
                                    insertCount++;
                                }
                            }
                        })();
                        
                        // Critical: Pause to let the event loop process stream chunks and keep the video alive
                        if (i + CHUNK_SIZE < programmes.length) {
                             await sleep(50); 
                        }
                    }

                    lastSyncStats.listingsStored += insertCount;
                    lastSyncStats.channelsProcessed += Object.keys(epgMap).length;
                    console.log(`[EPG Sync] Finished inserting ${insertCount} guides for "${provider.name}".`);
                } else {
                    console.log(`[EPG Sync] Warning: No <programme> tags found in XML.`);
                }
            } catch (dlErr) {
                console.error(`[EPG Sync] Error downloading or parsing XML: ${dlErr.message}`);
                lastSyncStats.errors++;
            }

            console.log(`[EPG Sync] Finished provider "${provider.name}".`);
        }

        lastSyncStats.completedAt = new Date().toISOString();

        // Store last EPG sync time
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .run('last_epg_sync_time', JSON.stringify(lastSyncStats.completedAt));

        console.log(`[EPG Sync] Complete. ${lastSyncStats.channelsProcessed} channels processed, ${lastSyncStats.listingsStored} listings stored, ${lastSyncStats.errors} errors.`);

    } catch (err) {
        console.error('[EPG Sync] Fatal error during sync:', err.message);
        lastSyncStats.completedAt = new Date().toISOString();
    } finally {
        isSyncing = false;
    }

    return lastSyncStats;
};

/**
 * Register user credentials for a provider and kick off EPG sync.
 * Credentials are stored in the settings table so the sync can run on a timer.
 */
const registerAndSync = async (db, providerId, user) => {
    // Read existing credentials list
    const existingRow = db.prepare("SELECT value FROM settings WHERE key = 'epg_sync_credentials'").get();
    let credsList = [];

    if (existingRow) {
        try {
            credsList = JSON.parse(existingRow.value);
        } catch (e) { }
    }

    // Upsert: replace entry for this provider
    credsList = credsList.filter(c => c.providerId !== providerId);
    credsList.push({ providerId, user: { username: user.username, passwordEncrypted: encryptSecret(user.password) } });

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run('epg_sync_credentials', JSON.stringify(credsList));

    console.log(`[EPG Sync] Credentials registered for provider ${providerId}. Kicking off sync...`);

    // Fire off sync (don't await — let it run in the background)
    runEPGSync(db).catch(err => console.error('[EPG Sync] Background sync error:', err.message));
};

/**
 * Start the periodic EPG sync timer.
 * Should be called once at server startup.
 */
const startEPGSyncTimer = (db) => {
    if (syncTimer) {
        clearInterval(syncTimer);
    }

    // Run an initial sync after a short startup delay (60s) to let the server settle
    setTimeout(() => {
        runEPGSync(db).catch(err => console.error('[EPG Sync] Startup sync error:', err.message));
    }, 60 * 1000);

    // Then run periodically
    syncTimer = setInterval(() => {
        runEPGSync(db).catch(err => console.error('[EPG Sync] Periodic sync error:', err.message));
    }, EPG_SYNC_INTERVAL_MS);

    console.log(`[EPG Sync] Timer started. Syncing every ${EPG_SYNC_INTERVAL_MS / 1000 / 60} minutes.`);
};

/**
 * Get cached EPG listings for a specific stream from the database.
 */
const getCachedEPG = (db, streamId, providerId) => {
    try {
        if (providerId) {
            const rows = db.prepare('SELECT * FROM epg_listings WHERE stream_id = ? AND provider_id = ? ORDER BY start_time ASC').all(streamId, providerId);
            return rows;
        }
        const rows = db.prepare('SELECT * FROM epg_listings WHERE stream_id = ? ORDER BY start_time ASC').all(streamId);
        return rows;
    } catch (e) {
        return [];
    }
};

/**
 * Get cached EPG listings for multiple streams at once.
 */
const getCachedEPGBatch = (db, streamIds, providerId) => {
    if (!streamIds || streamIds.length === 0) return {};

    try {
        const placeholders = streamIds.map(() => '?').join(',');
        let query = `SELECT * FROM epg_listings WHERE stream_id IN (${placeholders})`;
        const params = [...streamIds];

        if (providerId) {
            query += ' AND provider_id = ?';
            params.push(providerId);
        }

        query += ' ORDER BY start_time ASC';
        const rows = db.prepare(query).all(...params);

        // Group by stream_id
        const grouped = {};
        for (const row of rows) {
            if (!grouped[row.stream_id]) grouped[row.stream_id] = [];
            grouped[row.stream_id].push(row);
        }
        return grouped;
    } catch (e) {
        return {};
    }
};

const getEPGSyncStatus = () => {
    return { isSyncing, ...lastSyncStats };
};

module.exports = {
    registerAndSync,
    startEPGSyncTimer,
    runEPGSync,
    getCachedEPG,
    getCachedEPGBatch,
    getEPGSyncStatus
};
