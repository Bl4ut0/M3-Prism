const { get } = require('./httpClient');
const { getRuntimeConfig } = require('./runtimeConfig');

const getMetadataRuntimeConfig = () => {
    const { config } = getRuntimeConfig();
    return {
        apiKey: config.tmdbApiKey && config.tmdbApiKey !== 'YOUR_TMDB_API_KEY_HERE' ? config.tmdbApiKey : null,
        includeAdult: config.includeAdult,
        language: config.language,
    };
};

const cleanTitle = (filename) => {
    // Remove file extensions
    let name = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '');

    // Extract year if present (e.g. "Movie (2020)")
    let year = null;
    const yearMatch = name.match(/[ \(](\d{4})[ \)]/);
    if (yearMatch) {
        year = yearMatch[1];
    }

    // Remove common quality/scene tags junk
    name = name.replace(/[\[\(]?(2160p|1080p|720p|480p|4k|UHD|HDR|BluRay|WEB-DL|H\.264|x264|AAC|5\.1)[\]\)]?/gi, '');

    // Remove year from name for searching (TMDB handles year param separately usually, but putting it in query sometimes confuses it if not exact)
    // Actually, keeping year in query is often good if it is part of natural title, but stripping the (2020) format is good.
    name = name.replace(/\(\d{4}\).*$/, ''); // Remove (2020) and everything after

    // Trim special chars
    name = name.replace(/[\._\-]/g, ' ').trim();

    return { name, year };
};

const searchTMDB = async (query, type, year, metadataConfig) => {
    try {
        const url = `https://api.themoviedb.org/3/search/${type}`;
        const params = {
            api_key: metadataConfig.apiKey,
            query: query,
            include_adult: metadataConfig.includeAdult,
            language: metadataConfig.language,
        };
        if (year) {
            // For movies: primary_release_year, for tv: first_air_date_year
            if (type === 'movie') params.primary_release_year = year;
            else params.first_air_date_year = year;
        }

        const res = await get(url, { params });

        // If exact match found or high popularity, return it.
        // Returning first result is usually standard, but maybe filters?
        return res.data.results?.[0];
    } catch (e) {
        if (e.response && e.response.status === 429) {
            console.warn("TMDB Rate Limit Hit. Sleeping...");
            await new Promise(r => setTimeout(r, 2000));
        } else {
            console.error(`TMDB Search Error for '${query}':`, e.message);
        }
        return null;
    }
};

const scanLibrary = async (db) => {
    const metadataConfig = getMetadataRuntimeConfig();
    if (!metadataConfig.apiKey) {
        console.log("No valid TMDB API key found in runtime configuration.");
        return { success: false, skipped: true, updated: 0, count: 0, error: "Missing or default TMDB API key in runtime configuration" };
    }


    let updatedCount = 0;

    // 1. Scan Movies (process non-overridden items)
    // We limit batch size to allow progress reporting and prevent timeout loops
    const batchSize = 20;

    const movies = db.prepare(`
        SELECT stream_id, name FROM vod_active 
        WHERE stream_id NOT IN (SELECT item_id FROM metadata_overrides WHERE type='movie')
        LIMIT ?
    `).all(batchSize);



    for (const m of movies) {
        const { name, year } = cleanTitle(m.name);
        if (!name) continue;

        const match = await searchTMDB(name, 'movie', year, metadataConfig);
        if (match) {
            const poster = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null;
            const backdrop = match.backdrop_path ? `https://image.tmdb.org/t/p/original${match.backdrop_path}` : null;

            if (poster || backdrop) {
                db.prepare(`
                    INSERT OR REPLACE INTO metadata_overrides (item_id, type, poster, backdrop, logo)
                    VALUES (?, 'movie', ?, ?, ?)
                `).run(String(m.stream_id), poster, backdrop, null);
                updatedCount++;
            }
        }
        await new Promise(r => setTimeout(r, 300)); // Respect Rate Limits
    }

    // 2. Scan Series
    const series = db.prepare(`
        SELECT series_id, name FROM series_active 
        WHERE series_id NOT IN (SELECT item_id FROM metadata_overrides WHERE type='series')
        LIMIT ?
    `).all(batchSize);



    for (const s of series) {
        const { name, year } = cleanTitle(s.name);
        if (!name) continue;

        const match = await searchTMDB(name, 'tv', year, metadataConfig);
        if (match) {
            const poster = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null;
            const backdrop = match.backdrop_path ? `https://image.tmdb.org/t/p/original${match.backdrop_path}` : null;

            if (poster || backdrop) {
                db.prepare(`
                    INSERT OR REPLACE INTO metadata_overrides (item_id, type, poster, backdrop, logo)
                    VALUES (?, 'series', ?, ?, ?)
                `).run(String(s.series_id), poster, backdrop, null);
                updatedCount++;
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. Scan Channels (Only those missing icons)
    const channels = db.prepare(`
        SELECT stream_id, name FROM channels 
        WHERE (stream_icon IS NULL OR stream_icon = '')
        AND stream_id NOT IN (SELECT item_id FROM metadata_overrides WHERE type='channel')
        LIMIT ?
    `).all(batchSize);



    const cleanChannelName = (name) => {
        // Remove "24/7" variants
        let n = name.replace(/(24\/7|24x7|24 7)/gi, '').trim();
        // Remove common prefixes/suffixes
        n = n.replace(/^[A-Z]{2,3}:/, '').trim(); // e.g., US: UK:
        n = n.replace(/\b(FHD|HD|HEVC|4K|SD|VIP|RAW)\b/gi, '').trim();
        n = n.replace(/^\d+[\.\-\s]+/, '').trim(); // Leading numbers "1. "
        // Remove channel numbers in brackets/parentheses
        n = n.replace(/[\[\(][^\]\)]*[\]\)]/g, '').trim();
        return n;
    };

    for (const ch of channels) {
        const cleanName = cleanChannelName(ch.name);
        if (!cleanName || cleanName.length < 3) continue;

        // Try 'tv' search first as most 24/7 channels are shows
        let match = await searchTMDB(cleanName, 'tv', null, metadataConfig);

        // If no match, maybe it's a movie channel? try 'movie'
        if (!match) {
            match = await searchTMDB(cleanName, 'movie', null, metadataConfig);
        }

        if (match) {
            const poster = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : null;
            // Logos for channels are tricky, we usually just get the show poster. 
            // Ideally we want the 'logo' (TMDB has logos in images endpoint but search result just gives poster).
            // Poster is better than nothing.

            if (poster) {
                db.prepare(`
                    INSERT OR REPLACE INTO metadata_overrides (item_id, type, poster, backdrop, logo)
                    VALUES (?, 'channel', ?, ?, ?)
                `).run(String(ch.stream_id), poster, null, null);
                updatedCount++;
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }

    return { success: true, updated: updatedCount, count: movies.length + series.length + channels.length };
};

const startBackgroundScan = async (db) => {
    console.log("[Metadata] Background artwork scan started. This runs silently.");
    let working = true;
    let totalUpdated = 0;

    // We'll process in chunks to stay friendly to the event loop and TMDB
    while (working) {
        try {
            const result = await scanLibrary(db);
            totalUpdated += result.updated || 0;

            // If we processed fewer items than the batch size, we are likely done or close to done.
            // Or if count is 0, we are definitely done.
            if (!result.success || !result.count || result.updated === 0) {
                working = false;
                console.log(`[Metadata] Background scan complete. Total updated: ${totalUpdated}`);
            } else {
                // Sleep a bit between batches to be nice
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) {
            console.error("[Metadata] Background scan error:", e.message);
            working = false;
        }
    }
};

module.exports = { scanLibrary, startBackgroundScan };
