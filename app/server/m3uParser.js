/**
 * M3U/M3U8 Playlist Parser
 * Parses standard M3U format into channel objects for database import.
 */

const fs = require('fs');
const { get } = require('./httpClient');

/**
 * Parse M3U content string into an array of channel objects.
 * 
 * Handles standard M3U format:
 *   #EXTM3U url-tvg="..." ...
 *   #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
 *   http://stream-url.com/live/user/pass/12345.ts
 */
const parseM3U = (content) => {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length === 0) {
        return { channels: [], categories: [], epgUrl: null };
    }

    // Extract EPG URL from header
    let epgUrl = null;
    const header = lines[0];
    if (header.startsWith('#EXTM3U')) {
        const tvgMatch = header.match(/url-tvg="([^"]+)"/i);
        if (tvgMatch) epgUrl = tvgMatch[1];
    }

    const channels = [];
    const categorySet = new Set();
    let currentInfo = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('#EXTINF:')) {
            // Parse the EXTINF line
            const attrs = {};

            // Extract key="value" pairs
            const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
            let match;
            while ((match = attrRegex.exec(line)) !== null) {
                attrs[match[1].toLowerCase()] = match[2];
            }

            // Display name is after the last comma
            const commaIdx = line.lastIndexOf(',');
            const displayName = commaIdx > -1 ? line.substring(commaIdx + 1).trim() : 'Unknown';

            currentInfo = {
                name: displayName,
                tvgId: attrs['tvg-id'] || '',
                tvgName: attrs['tvg-name'] || displayName,
                tvgLogo: attrs['tvg-logo'] || '',
                groupTitle: attrs['group-title'] || 'Uncategorized',
            };

            if (currentInfo.groupTitle) {
                categorySet.add(currentInfo.groupTitle);
            }
        } else if (!line.startsWith('#') && currentInfo) {
            // This is a stream URL
            channels.push({
                ...currentInfo,
                url: line,
            });
            currentInfo = null;
        }
    }

    const categories = Array.from(categorySet).sort().map((name, idx) => ({
        id: `m3u_cat_${idx}`,
        name
    }));

    console.log(`[M3U Parser] Parsed ${channels.length} channels in ${categories.length} categories. EPG: ${epgUrl || 'none'}`);

    return { channels, categories, epgUrl };
};

/**
 * Download and parse an M3U from a URL.
 */
const parseM3UFromUrl = async (url) => {
    const response = await get(url, {
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    return parseM3U(typeof response.data === 'string' ? response.data : String(response.data));
};

/**
 * Parse an M3U from a local file path.
 */
const parseM3UFromFile = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseM3U(content);
};

/**
 * Import parsed M3U channels into the database.
 */
const importM3UToDb = (db, providerId, parsed) => {
    const { channels, categories, epgUrl } = parsed;

    // Insert categories
    const insertCat = db.prepare('INSERT OR REPLACE INTO categories (id, name, provider_id) VALUES (?, ?, ?)');

    // Insert channels — use a hash of URL as stream_id since M3U doesn't have numeric IDs
    const insertChan = db.prepare(`
        INSERT OR REPLACE INTO channels (
            stream_id, name, stream_icon, category_id, num, epg_channel_id, provider_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Build category name→id map
    const catMap = {};
    categories.forEach(c => { catMap[c.name] = c.id; });

    db.transaction(() => {
        // Clear old data for this provider
        db.prepare('DELETE FROM channels WHERE provider_id = ?').run(providerId);
        db.prepare('DELETE FROM categories WHERE provider_id = ?').run(providerId);

        for (const cat of categories) {
            insertCat.run(cat.id, cat.name, providerId);
        }

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            // Generate a stable numeric ID from the URL hash
            const crypto = require('crypto');
            const streamId = parseInt(crypto.createHash('md5').update(ch.url).digest('hex').substring(0, 8), 16);
            const catId = catMap[ch.groupTitle] || null;

            insertChan.run(
                streamId,
                ch.name,
                ch.tvgLogo || null,
                catId,
                i + 1,            // Channel number
                ch.tvgId || null,  // EPG channel ID
                providerId
            );
        }
    })();

    // Store the EPG URL and stream URLs in settings for later use
    if (epgUrl) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .run(`m3u_epg_url_${providerId}`, epgUrl);
    }

    // Store the M3U channel URLs for playback (since M3U URLs are pre-authenticated)
    const urlMap = {};
    channels.forEach(ch => {
        const crypto = require('crypto');
        const streamId = parseInt(crypto.createHash('md5').update(ch.url).digest('hex').substring(0, 8), 16);
        urlMap[streamId] = ch.url;
    });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(`m3u_urls_${providerId}`, JSON.stringify(urlMap));

    console.log(`[M3U Import] Imported ${channels.length} channels for provider ${providerId}`);
    return { channelCount: channels.length, categoryCount: categories.length, epgUrl };
};

module.exports = { parseM3U, parseM3UFromUrl, parseM3UFromFile, importM3UToDb };
