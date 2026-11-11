/**
 * PortfoliOS / Browser Serverless Adapter for M3 Prism
 * Provides full provider, profile, Xtream Codes, M3U, EPG, Favorites, Watch History,
 * and Native Relay HTTP/stream bridging when running inside PortfoliOS or static web mode.
 */

const DB_NAME = 'm3prism_portfolios_catalog_v1';
const DB_VERSION = 1;
const STORES = [
    'categories',
    'channels',
    'vod_categories',
    'vod_items',
    'series_categories',
    'series_items',
    'epg_listings',
    'm3u_urls'
];

let dbPromise = null;

function getParentWindow() {
    try {
        if (window.parent && window.parent !== window && window.parent.location?.origin === window.location.origin) {
            return window.parent;
        }
    } catch {
        // Cross-origin parent access ignored
    }
    return null;
}

export function isPortfoliOSHosted() {
    if (typeof window === 'undefined') return false;
    if (window.location.protocol === 'file:') return true;
    if (window.location.pathname.includes('/apps/')) return true;
    if (window.location.search.includes('portfolios=1')) return true;
    if (getParentWindow()) return true;
    return false;
}

export function getNativeRelay() {
    if (typeof window === 'undefined') return null;
    if (window.PortfoliOSNativeRelay && typeof window.PortfoliOSNativeRelay.fetch === 'function') {
        return window.PortfoliOSNativeRelay;
    }
    const parentWin = getParentWindow();
    if (parentWin?.PortfoliOSNativeRelay && typeof parentWin.PortfoliOSNativeRelay.fetch === 'function') {
        return parentWin.PortfoliOSNativeRelay;
    }
    return null;
}

export function isNativeRelayAvailable() {
    const relay = getNativeRelay();
    return Boolean(relay && typeof relay.isAvailable === 'function' && relay.isAvailable());
}

function getActiveOsUserId() {
    const parentWin = getParentWindow();
    const userId = parentWin?.state?.currentUserId || window.state?.currentUserId || 'default';
    return String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getStorageKey() {
    return `m3prism_portfolios_vault_v1_${getActiveOsUserId()}`;
}

function getDefaultVault() {
    return {
        schemaVersion: 1,
        runtimeConfig: {
            tmdbApiKey: '',
            userAgent: 'VLC/3.0.16 LibVLC/3.0.16',
            configPath: '/apps/IPTV Stream/m3prism-vault.json'
        },
        providers: [],
        profiles: [],
        activeSession: null,
        favorites: [],
        recentChannels: [],
        watchHistory: [],
        metadataOverrides: {}
    };
}

function loadVault() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ...getDefaultVault(), ...parsed };
        }
    } catch (e) {
        console.warn('[M3Prism Serverless] Failed to read localStorage vault:', e);
    }
    return getDefaultVault();
}

function saveVault(vault) {
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(vault));
    } catch (e) {
        console.warn('[M3Prism Serverless] Failed to save localStorage vault:', e);
    }
    // Mirror non-secret metadata to PortfoliOS SystemFS when hosted inside PortfoliOS
    const parentWin = getParentWindow();
    const systemFS = parentWin?.SystemFS || window.SystemFS;
    if (systemFS && typeof systemFS.writeFile === 'function') {
        try {
            const sanitizedProfiles = (vault.profiles || []).map(p => ({ ...p, password: '' }));
            const sanitizedVault = {
                ...vault,
                profiles: sanitizedProfiles,
                activeSession: vault.activeSession
                    ? { ...vault.activeSession, password: '' }
                    : null,
                updatedAt: new Date().toISOString()
            };
            const payload = JSON.stringify(sanitizedVault, null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            systemFS.writeFile(
                '/apps/IPTV Stream/m3prism-vault.json',
                'm3prism-vault.json',
                '/apps/IPTV Stream',
                blob,
                blob.size,
                'application/json',
                false,
                { source: 'm3prism-vault' }
            ).catch(() => {});
        } catch {
            // Best-effort SystemFS sync
        }
    }
}

// Import any existing session from classic PortfoliOS IPTV Stream if M3Prism vault is empty
function maybeImportClassicPortfoliOSSession(vault) {
    if (vault.providers.length > 0 || vault.profiles.length > 0) return vault;
    try {
        const parentWin = getParentWindow() || window;
        const rawSession = parentWin.sessionStorage?.getItem('portfolios_iptv_session_v1')
            || sessionStorage.getItem('portfolios_iptv_session_v1');
        if (!rawSession) return vault;
        const session = JSON.parse(rawSession);
        if (!session || !session.sourceType) return vault;

        if (session.sourceType === 'xtream' && session.server && session.username && session.password) {
            const providerId = `provider_${Date.now()}`;
            const profileId = `profile_${Date.now()}`;
            const now = new Date().toISOString();
            const provider = {
                id: providerId,
                name: session.sourceLabel || 'PortfoliOS IPTV',
                url: session.server,
                type: 'xtream',
                timeshift: 0
            };
            const profile = {
                id: profileId,
                name: session.sourceLabel || session.username,
                type: 'xtream',
                provider_id: providerId,
                username: session.username,
                password: session.password,
                user_agent: null,
                timeshift: 0,
                is_active: 1,
                last_used: now,
                created_at: now
            };
            vault.providers.push(provider);
            vault.profiles.push(profile);
            vault.activeSession = {
                username: session.username,
                password: session.password,
                providerId,
                profileId,
                sessionType: 'xtream',
                userInfo: {
                    username: session.username,
                    auth: 1,
                    status: 'Active'
                }
            };
            saveVault(vault);
        }
    } catch {
        // Ignore import errors
    }
    return vault;
}

function openCatalogDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const store of STORES) {
                if (!db.objectStoreNames.contains(store)) {
                    db.createObjectStore(store, { keyPath: 'providerId' });
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function getProviderStoreData(storeName, providerId) {
    try {
        const db = await openCatalogDb();
        return await new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(String(providerId));
            req.onsuccess = () => resolve(req.result?.items || null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function setProviderStoreData(storeName, providerId, items) {
    try {
        const db = await openCatalogDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put({ providerId: String(providerId), items, updatedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn(`[M3Prism Serverless] IndexedDB write failed for ${storeName}:`, e);
    }
}

async function clearCatalogDb(storeNames = STORES) {
    try {
        const db = await openCatalogDb();
        await new Promise((resolve) => {
            const tx = db.transaction(storeNames, 'readwrite');
            for (const name of storeNames) {
                tx.objectStore(name).clear();
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    } catch {
        // Ignore clear errors
    }
}

function hashUrlToId(url) {
    let h1 = 0xdeadbeef ^ url.length;
    let h2 = 0x41c6ce57 ^ url.length;
    for (let i = 0; i < url.length; i++) {
        const ch = url.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return (h1 >>> 0) || 1;
}

export async function relayFetch(url, options = {}) {
    const relay = getNativeRelay();
    const isHttpTarget = /^http:\/\//i.test(url);
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const vault = loadVault();
    const activeProfile = vault.profiles.find(p => p.is_active === 1);
    const userAgent = options.userAgent || activeProfile?.user_agent || vault.runtimeConfig?.userAgent || 'VLC/3.0.16 LibVLC/3.0.16';

    const tryRelay = async () => {
        if (!relay) {
            throw new Error(
                isHttpTarget && isHttpsPage
                    ? 'HTTP IPTV source requires the PortfoliOS Native Relay Chrome extension on HTTPS.'
                    : 'Network request failed and PortfoliOS Native Relay is unavailable.'
            );
        }
        const res = await relay.fetch(url, {
            method: options.method || 'GET',
            headers: {
                'User-Agent': userAgent,
                ...(options.headers || {})
            },
            body: options.body,
            timeout: options.timeout || 30000,
            responseType: options.responseType || 'text'
        });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}: ${res.statusText || 'Request failed'}`);
            err.status = res.status;
            throw err;
        }
        return res;
    };

    if (isHttpTarget && isHttpsPage) {
        return tryRelay();
    }

    if (relay && isNativeRelayAvailable() && options.preferRelay !== false) {
        try {
            return await tryRelay();
        } catch (relayErr) {
            if (isHttpTarget && isHttpsPage) throw relayErr;
        }
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || 25000);
        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body,
                signal: controller.signal,
                credentials: 'omit',
                cache: 'no-store'
            });
            if (!response.ok) {
                const err = new Error(`HTTP ${response.status}`);
                err.status = response.status;
                throw err;
            }
            return {
                ok: true,
                status: response.status,
                statusText: response.statusText,
                url: response.url || url,
                contentType: response.headers.get('content-type') || '',
                text: () => response.text(),
                json: () => response.json(),
                arrayBuffer: () => response.arrayBuffer()
            };
        } finally {
            clearTimeout(timer);
        }
    } catch (fetchErr) {
        if (relay) {
            return tryRelay();
        }
        throw fetchErr;
    }
}

function getActiveCredentials(vault, providerId, fallbackUser) {
    if (fallbackUser?.username && fallbackUser?.password) {
        return { username: fallbackUser.username, password: fallbackUser.password };
    }
    if (vault.activeSession?.password && (!providerId || vault.activeSession.providerId === providerId)) {
        return { username: vault.activeSession.username, password: vault.activeSession.password };
    }
    const profile = vault.profiles.find(p => (!providerId || p.provider_id === providerId) && p.is_active === 1)
        || vault.profiles.find(p => !providerId || p.provider_id === providerId);
    if (profile?.username && profile?.password) {
        return { username: profile.username, password: profile.password };
    }
    return fallbackUser || null;
}

export function resolveStreamUrlForPlayback(rawUrl, options = {}) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const vault = loadVault();
    let finalUrl = rawUrl;

    // If URL is an /api/proxy wrapper, unwrap the target URL in serverless mode
    if (finalUrl.includes('/api/proxy?url=')) {
        try {
            const parsed = new URL(finalUrl, window.location.origin);
            const inner = parsed.searchParams.get('url');
            if (inner) finalUrl = decodeURIComponent(inner);
        } catch {
            // Keep original
        }
    }

    const creds = getActiveCredentials(vault, vault.activeSession?.providerId);
    if (creds?.username && creds?.password) {
        const missingPassSequence = `/${creds.username}//`;
        if (finalUrl.includes(missingPassSequence)) {
            finalUrl = finalUrl.replace(missingPassSequence, `/${creds.username}/${encodeURIComponent(creds.password)}/`);
        }
    }

    // For live Xtream streams in browser/Native Relay mode, prefer .m3u8 (chunked HLS) over infinite .ts stream
    if (!options.keepTs && /\/live\/[^/]+\/[^/]+\/\d+\.ts(?:$|\?)/i.test(finalUrl)) {
        finalUrl = finalUrl.replace(/\.ts($|\?)/i, '.m3u8$1');
    }

    return finalUrl;
}

function parseM3UContent(content) {
    const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return { channels: [], categories: [], epgUrl: null };

    let epgUrl = null;
    if (lines[0].startsWith('#EXTM3U')) {
        const tvgMatch = lines[0].match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i);
        if (tvgMatch) epgUrl = tvgMatch[1];
    }

    const channels = [];
    const categorySet = new Set();
    let currentInfo = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#EXTINF:')) {
            const attrs = {};
            const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
            let match;
            while ((match = attrRegex.exec(line)) !== null) {
                attrs[match[1].toLowerCase()] = match[2];
            }
            const commaIdx = line.lastIndexOf(',');
            const displayName = commaIdx > -1 ? line.substring(commaIdx + 1).trim() : 'Unknown';
            currentInfo = {
                name: displayName,
                tvgId: attrs['tvg-id'] || '',
                tvgName: attrs['tvg-name'] || displayName,
                tvgLogo: attrs['tvg-logo'] || '',
                groupTitle: attrs['group-title'] || 'Uncategorized'
            };
            if (currentInfo.groupTitle) categorySet.add(currentInfo.groupTitle);
        } else if (!line.startsWith('#') && currentInfo) {
            channels.push({ ...currentInfo, url: line });
            currentInfo = null;
        }
    }

    const categories = Array.from(categorySet).sort().map((name, idx) => ({
        id: `m3u_cat_${idx}`,
        name
    }));

    return { channels, categories, epgUrl };
}

// ============================================================================
// Exported Serverless API Methods (matching src/api/api.js)
// ============================================================================

export async function checkServerStatus() {
    return {
        status: 'online',
        mode: 'portfolios-serverless',
        relayAvailable: isNativeRelayAvailable()
    };
}

export async function getSetupStatus() {
    const vault = maybeImportClassicPortfoliOSSession(loadVault());
    return {
        configured: vault.profiles.length > 0 || vault.providers.length > 0,
        mode: 'portfolios',
        profileCount: vault.profiles.length,
        providerCount: vault.providers.length,
        runtimeMode: 'portfolios',
        savedProfileLoginEnabled: true
    };
}

export async function getRuntimeConfig() {
    const vault = loadVault();
    return vault.runtimeConfig;
}

export async function updateRuntimeConfig(config) {
    const vault = loadVault();
    vault.runtimeConfig = {
        ...vault.runtimeConfig,
        tmdbApiKey: config.tmdbApiKey ?? vault.runtimeConfig.tmdbApiKey,
        userAgent: config.userAgent || vault.runtimeConfig.userAgent || 'VLC/3.0.16 LibVLC/3.0.16'
    };
    saveVault(vault);
    return vault.runtimeConfig;
}

export async function getProviders() {
    const vault = maybeImportClassicPortfoliOSSession(loadVault());
    return vault.providers;
}

export async function createProvider(provider) {
    const vault = loadVault();
    const id = `provider_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newProvider = {
        id,
        name: provider.name || 'My IPTV',
        url: (provider.url || '').trim(),
        type: provider.type || 'xtream',
        timeshift: 0
    };
    vault.providers.push(newProvider);
    saveVault(vault);
    return { success: true, id, ...newProvider };
}

export async function updateProvider(providerId, data) {
    const vault = loadVault();
    vault.providers = vault.providers.map(p => p.id === providerId ? { ...p, ...data } : p);
    saveVault(vault);
    return { success: true };
}

export async function deleteProvider(providerId) {
    const vault = loadVault();
    vault.providers = vault.providers.filter(p => p.id !== providerId);
    saveVault(vault);
    return { success: true };
}

export async function updateTimeshift(providerId, timeshift) {
    const vault = loadVault();
    vault.providers = vault.providers.map(p => p.id === providerId ? { ...p, timeshift } : p);
    saveVault(vault);
    return { success: true, timeshift };
}

export async function testProviderConnection(url, username, password) {
    try {
        const baseUrl = String(url || '').trim().replace(/\/+$/, '');
        const params = new URLSearchParams({ username, password });
        const res = await relayFetch(`${baseUrl}/player_api.php?${params.toString()}`, { timeout: 15000 });
        const data = await res.json();
        if (String(data?.user_info?.auth) === '1') {
            return { success: true, user_info: data.user_info };
        }
        return { success: false, error: 'Invalid credentials' };
    } catch (err) {
        return { success: false, error: err.message || 'Provider connection failed' };
    }
}

export async function importM3U(url, providerId, name) {
    const vault = loadVault();
    const cleanUrl = String(url || '').trim();
    const res = await relayFetch(cleanUrl, { timeout: 45000 });
    const text = await res.text();
    const parsed = parseM3UContent(text);
    if (parsed.channels.length === 0) {
        return { success: false, error: 'No channels found in M3U playlist' };
    }

    let targetProviderId = providerId;
    if (!targetProviderId) {
        targetProviderId = `provider_${Date.now()}`;
        vault.providers.push({
            id: targetProviderId,
            name: name || 'M3U Playlist',
            url: cleanUrl,
            type: 'm3u',
            timeshift: 0
        });
        saveVault(vault);
    }

    const catMap = {};
    parsed.categories.forEach(c => { catMap[c.name] = c.id; });
    const urlMap = {};
    const dbChannels = parsed.channels.map((ch, idx) => {
        const streamId = hashUrlToId(ch.url);
        urlMap[streamId] = ch.url;
        return {
            stream_id: streamId,
            name: ch.name,
            stream_icon: ch.tvgLogo || null,
            category_id: catMap[ch.groupTitle] || null,
            category_name: ch.groupTitle || 'Uncategorized',
            num: idx + 1,
            epg_channel_id: ch.tvgId || null,
            provider_id: targetProviderId
        };
    });

    await Promise.all([
        setProviderStoreData('categories', targetProviderId, parsed.categories.map(c => ({ ...c, provider_id: targetProviderId }))),
        setProviderStoreData('channels', targetProviderId, dbChannels),
        setProviderStoreData('m3u_urls', targetProviderId, urlMap)
    ]);

    return {
        success: true,
        providerId: targetProviderId,
        channelCount: dbChannels.length,
        categoryCount: parsed.categories.length,
        epgUrl: parsed.epgUrl
    };
}

function toPublicProfile(profile) {
    if (!profile) return null;
    const { password: _removed, ...rest } = profile;
    return rest;
}

export async function getProfiles() {
    const vault = maybeImportClassicPortfoliOSSession(loadVault());
    return vault.profiles
        .map(toPublicProfile)
        .sort((a, b) => (b.is_active || 0) - (a.is_active || 0));
}

export async function createProfile(profileData) {
    const vault = loadVault();
    const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const newProfile = {
        id,
        name: (profileData.name || 'IPTV Profile').trim(),
        type: profileData.type === 'm3u' ? 'm3u' : 'xtream',
        provider_id: profileData.providerId || profileData.provider_id,
        username: profileData.username || null,
        password: profileData.password || null,
        m3u_url: profileData.m3uUrl || profileData.m3u_url || null,
        user_agent: profileData.user_agent || null,
        timeshift: Number(profileData.timeshift) || 0,
        is_active: 1,
        last_used: now,
        created_at: now
    };
    vault.profiles.forEach(p => { p.is_active = 0; });
    vault.profiles.push(newProfile);
    saveVault(vault);
    return { success: true, id, profile: toPublicProfile(newProfile) };
}

export async function updateProfile(profileId, data) {
    const vault = loadVault();
    let updated = null;
    vault.profiles = vault.profiles.map(p => {
        if (p.id === profileId) {
            updated = {
                ...p,
                name: data.name ?? p.name,
                user_agent: data.user_agent ?? p.user_agent,
                timeshift: data.timeshift !== undefined ? Number(data.timeshift) : p.timeshift
            };
            return updated;
        }
        return p;
    });
    saveVault(vault);
    return { success: true, profile: toPublicProfile(updated) };
}

export async function activateProfile(profileId) {
    const vault = loadVault();
    const now = new Date().toISOString();
    vault.profiles.forEach(p => {
        p.is_active = p.id === profileId ? 1 : 0;
        if (p.id === profileId) p.last_used = now;
    });
    saveVault(vault);
    return { success: true };
}

export async function deleteProfile(profileId) {
    const vault = loadVault();
    vault.profiles = vault.profiles.filter(p => p.id !== profileId);
    if (vault.activeSession?.profileId === profileId) {
        vault.activeSession = null;
    }
    saveVault(vault);
    return { success: true };
}

export async function getProfileCredentials(profileId) {
    const vault = loadVault();
    const profile = vault.profiles.find(p => p.id === profileId);
    return profile ? { username: profile.username, hasPassword: Boolean(profile.password) } : null;
}

export async function authenticateUser(providerId, username, password, profileName) {
    const vault = loadVault();
    const provider = vault.providers.find(p => p.id === providerId);
    if (!provider) throw new Error('Provider not found');

    const baseUrl = provider.url.replace(/\/+$/, '');
    const params = new URLSearchParams({ username, password });
    const res = await relayFetch(`${baseUrl}/player_api.php?${params.toString()}`, { timeout: 15000 });
    const data = await res.json();

    if (!data?.user_info || String(data.user_info.auth) !== '1') {
        throw new Error('Invalid Credentials with IPTV Provider');
    }

    const now = new Date().toISOString();
    let profile = vault.profiles.find(p => p.provider_id === providerId && p.username === username);
    vault.profiles.forEach(p => { p.is_active = 0; });

    if (!profile) {
        profile = {
            id: `profile_${Date.now()}`,
            name: (profileName && profileName.trim()) ? profileName.trim() : username,
            type: provider.type || 'xtream',
            provider_id: provider.id,
            username,
            password,
            user_agent: null,
            timeshift: 0,
            is_active: 1,
            last_used: now,
            created_at: now
        };
        vault.profiles.push(profile);
    } else {
        profile.name = (profileName && profileName.trim()) ? profileName.trim() : profile.name;
        profile.password = password;
        profile.is_active = 1;
        profile.last_used = now;
    }

    const userInfo = { ...data.user_info, password: '' };
    vault.activeSession = {
        username,
        password,
        providerId: provider.id,
        profileId: profile.id,
        sessionType: provider.type || 'xtream',
        userInfo
    };
    saveVault(vault);

    return {
        success: true,
        user_info: userInfo,
        provider,
        profile: toPublicProfile(profile)
    };
}

export async function loginWithProfile(profileId) {
    const vault = loadVault();
    const profile = vault.profiles.find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Profile not found' };
    const provider = vault.providers.find(p => p.id === profile.provider_id);
    if (!provider) return { success: false, error: 'Provider not found' };

    const now = new Date().toISOString();
    if (profile.type === 'm3u' || provider.type === 'm3u') {
        vault.profiles.forEach(p => { p.is_active = p.id === profileId ? 1 : 0; });
        profile.last_used = now;
        const userInfo = { username: profile.username || profile.name, auth: 1, status: 'Active' };
        vault.activeSession = {
            username: userInfo.username,
            providerId: provider.id,
            profileId: profile.id,
            sessionType: 'm3u',
            userInfo
        };
        saveVault(vault);
        return { success: true, user_info: userInfo, provider, profile: toPublicProfile(profile) };
    }

    return authenticateUser(provider.id, profile.username, profile.password, profile.name);
}

export async function verifySession() {
    const vault = maybeImportClassicPortfoliOSSession(loadVault());
    if (!vault.activeSession) {
        const activeProfile = vault.profiles.find(p => p.is_active === 1);
        if (!activeProfile) return null;
        const provider = vault.providers.find(p => p.id === activeProfile.provider_id);
        if (!provider) return null;
        return {
            user: { username: activeProfile.username || activeProfile.name, auth: 1, status: 'Active' },
            provider,
            profile: toPublicProfile(activeProfile),
            sessionType: activeProfile.type || 'xtream',
            profileId: activeProfile.id
        };
    }

    const provider = vault.providers.find(p => p.id === vault.activeSession.providerId);
    const profile = vault.profiles.find(p => p.id === vault.activeSession.profileId);
    if (!provider || !profile) return null;

    return {
        user: vault.activeSession.userInfo || { username: vault.activeSession.username, auth: 1 },
        provider,
        profile: toPublicProfile(profile),
        sessionType: vault.activeSession.sessionType || 'xtream',
        profileId: profile.id
    };
}

export async function logoutUser() {
    const vault = loadVault();
    vault.activeSession = null;
    saveVault(vault);
    return { success: true };
}

export async function fetchXtreamData(providerUrl, params = {}) {
    try {
        const vault = loadVault();
        const creds = getActiveCredentials(vault, vault.activeSession?.providerId, {
            username: params.username,
            password: params.password
        });
        const mergedParams = {
            ...params,
            username: params.username || creds?.username || '',
            password: params.password || creds?.password || ''
        };
        const baseUrl = String(providerUrl || '').replace(/\/+$/, '');
        const queryString = new URLSearchParams(mergedParams).toString();
        const res = await relayFetch(`${baseUrl}/player_api.php?${queryString}`, { timeout: 30000 });
        return await res.json();
    } catch (error) {
        console.error('[M3Prism Serverless] Xtream Data Fetch Error:', error);
        return [];
    }
}

export async function syncAllData(providerId, user) {
    const vault = loadVault();
    const provider = vault.providers.find(p => p.id === providerId);
    if (!provider) throw new Error('Provider not found');
    if (provider.type === 'm3u') {
        return importM3U(provider.url, provider.id, provider.name);
    }

    const creds = getActiveCredentials(vault, providerId, user);
    if (!creds?.username || !creds?.password) {
        throw new Error('Missing credentials for provider sync');
    }

    const baseUrl = provider.url.replace(/\/+$/, '');
    const callAction = async (action, timeout = 45000) => {
        const qs = new URLSearchParams({
            username: creds.username,
            password: creds.password,
            action
        }).toString();
        const res = await relayFetch(`${baseUrl}/player_api.php?${qs}`, { timeout });
        return res.json();
    };

    // 1. Live TV Categories & Streams
    try {
        const [liveCats, liveStreams] = await Promise.all([
            callAction('get_live_categories', 25000).catch(() => []),
            callAction('get_live_streams', 60000).catch(() => [])
        ]);
        const catNameMap = {};
        const normCats = (Array.isArray(liveCats) ? liveCats : []).map(c => {
            catNameMap[c.category_id] = c.category_name;
            return { id: String(c.category_id), category_id: String(c.category_id), name: c.category_name, provider_id: providerId };
        });
        const normStreams = (Array.isArray(liveStreams) ? liveStreams : []).map((ch, idx) => ({
            stream_id: ch.stream_id,
            name: ch.name,
            stream_icon: ch.stream_icon || ch.cover || ch.thumb || null,
            category_id: String(ch.category_id || ''),
            category_name: catNameMap[ch.category_id] || 'Live TV',
            num: ch.num || idx + 1,
            epg_channel_id: ch.epg_channel_id || null,
            provider_id: providerId
        }));
        await Promise.all([
            setProviderStoreData('categories', providerId, normCats),
            setProviderStoreData('channels', providerId, normStreams)
        ]);
    } catch (e) {
        console.warn('[M3Prism Serverless] Live TV sync warning:', e);
    }

    // 2. Movies (VOD)
    try {
        const [vodCats, vodStreams] = await Promise.all([
            callAction('get_vod_categories', 25000).catch(() => []),
            callAction('get_vod_streams', 60000).catch(() => [])
        ]);
        const normVodCats = (Array.isArray(vodCats) ? vodCats : []).map(c => ({
            id: String(c.category_id),
            category_id: String(c.category_id),
            name: c.category_name,
            provider_id: providerId
        }));
        const normVodItems = (Array.isArray(vodStreams) ? vodStreams : []).map(m => ({
            stream_id: m.stream_id,
            name: m.name,
            stream_icon: m.stream_icon || m.cover || null,
            poster: m.stream_icon || m.cover || null,
            category_id: String(m.category_id || ''),
            container_extension: m.container_extension || 'mp4',
            rating: m.rating || '',
            provider_id: providerId
        }));
        await Promise.all([
            setProviderStoreData('vod_categories', providerId, normVodCats),
            setProviderStoreData('vod_items', providerId, normVodItems)
        ]);
    } catch (e) {
        console.warn('[M3Prism Serverless] VOD sync warning:', e);
    }

    // 3. Series
    try {
        const [serCats, serItems] = await Promise.all([
            callAction('get_series_categories', 25000).catch(() => []),
            callAction('get_series', 60000).catch(() => [])
        ]);
        const normSerCats = (Array.isArray(serCats) ? serCats : []).map(c => ({
            id: String(c.category_id),
            category_id: String(c.category_id),
            name: c.category_name,
            provider_id: providerId
        }));
        const normSerItems = (Array.isArray(serItems) ? serItems : []).map(s => ({
            series_id: s.series_id,
            name: s.name,
            cover: s.cover || null,
            poster: s.cover || null,
            category_id: String(s.category_id || ''),
            rating: s.rating || '',
            provider_id: providerId
        }));
        await Promise.all([
            setProviderStoreData('series_categories', providerId, normSerCats),
            setProviderStoreData('series_items', providerId, normSerItems)
        ]);
    } catch (e) {
        console.warn('[M3Prism Serverless] Series sync warning:', e);
    }

    return { success: true };
}

export async function fetchCachedCategories(providerId) {
    const items = await getProviderStoreData('categories', providerId);
    return items || [];
}

export async function fetchCachedChannels(providerId, categoryId) {
    const items = (await getProviderStoreData('channels', providerId)) || [];
    if (categoryId) {
        return items.filter(ch => String(ch.category_id) === String(categoryId));
    }
    return items;
}

export async function fetchCachedVodCategories(providerId, type) {
    const store = type === 'series' ? 'series_categories' : 'vod_categories';
    return (await getProviderStoreData(store, providerId)) || [];
}

export async function fetchCachedVodItems(providerId, type, categoryId) {
    const store = type === 'series' ? 'series_items' : 'vod_items';
    const items = (await getProviderStoreData(store, providerId)) || [];
    if (categoryId) {
        return items.filter(item => String(item.category_id) === String(categoryId));
    }
    return items;
}

export async function getLiveStreamUrl(streamId, providerId) {
    const urlMap = await getProviderStoreData('m3u_urls', providerId);
    return urlMap ? (urlMap[streamId] || '') : '';
}

export async function globalSearch(query, providerId) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { channels: [], movies: [], series: [], total: 0 };

    const [channels, movies, series] = await Promise.all([
        fetchCachedChannels(providerId),
        fetchCachedVodItems(providerId, 'movie'),
        fetchCachedVodItems(providerId, 'series')
    ]);

    const matchedChannels = channels.filter(c => String(c.name || '').toLowerCase().includes(q)).slice(0, 50);
    const matchedMovies = movies.filter(m => String(m.name || '').toLowerCase().includes(q)).slice(0, 50);
    const matchedSeries = series.filter(s => String(s.name || '').toLowerCase().includes(q)).slice(0, 50);

    return {
        channels: matchedChannels,
        movies: matchedMovies,
        series: matchedSeries,
        total: matchedChannels.length + matchedMovies.length + matchedSeries.length
    };
}

export async function saveWatchProgress(userId, streamId, type, parentId, name, poster, time, duration) {
    const vault = loadVault();
    const key = String(streamId);
    vault.watchHistory = (vault.watchHistory || []).filter(item => !(item.user_id === userId && String(item.stream_id) === key));
    if (!(duration > 0 && time > duration * 0.95)) {
        vault.watchHistory.unshift({
            user_id: userId,
            stream_id: key,
            type: type || 'movie',
            parent_id: parentId || null,
            name: name || 'Unknown Title',
            poster: poster || '',
            resume_time: Math.floor(time),
            duration: Math.floor(duration || 0),
            last_watched: new Date().toISOString()
        });
    }
    vault.watchHistory = vault.watchHistory.slice(0, 100);
    saveVault(vault);
    return { success: true };
}

export async function getWatchProgress(userId, streamId) {
    const vault = loadVault();
    const found = (vault.watchHistory || []).find(item => item.user_id === userId && String(item.stream_id) === String(streamId));
    return found || { resume_time: 0 };
}

export async function getContinueWatchingList(userId, type) {
    const vault = loadVault();
    return (vault.watchHistory || [])
        .filter(item => (!userId || item.user_id === userId) && (!type || item.type === type))
        .slice(0, 20);
}

export async function getContinueWatching(type) {
    const vault = loadVault();
    return getContinueWatchingList(vault.activeSession?.username, type);
}

export async function toggleFavorite(itemId, itemType, name, poster, providerId) {
    const vault = loadVault();
    const userId = vault.activeSession?.username || 'default';
    const idx = (vault.favorites || []).findIndex(
        f => f.user_id === userId && String(f.item_id) === String(itemId) && f.item_type === itemType
    );
    if (idx >= 0) {
        vault.favorites.splice(idx, 1);
        saveVault(vault);
        return { favorited: false };
    }
    vault.favorites = vault.favorites || [];
    vault.favorites.unshift({
        id: Date.now(),
        user_id: userId,
        item_id: String(itemId),
        item_type: itemType,
        name: name || null,
        poster: poster || null,
        provider_id: providerId || null,
        created_at: new Date().toISOString()
    });
    saveVault(vault);
    return { favorited: true };
}

export async function getFavorites(type, providerId) {
    const vault = loadVault();
    return (vault.favorites || []).filter(
        f => (!type || f.item_type === type) && (!providerId || f.provider_id === providerId)
    );
}

export async function checkFavorite(itemId, itemType) {
    const vault = loadVault();
    const found = (vault.favorites || []).some(
        f => String(f.item_id) === String(itemId) && f.item_type === itemType
    );
    return { favorited: found };
}

export async function recordRecentChannel(streamId, name, streamIcon, providerId) {
    const vault = loadVault();
    vault.recentChannels = (vault.recentChannels || []).filter(c => String(c.stream_id) !== String(streamId));
    vault.recentChannels.unshift({
        stream_id: streamId,
        name: name || '',
        stream_icon: streamIcon || null,
        provider_id: providerId || null,
        last_watched: new Date().toISOString()
    });
    vault.recentChannels = vault.recentChannels.slice(0, 20);
    saveVault(vault);
}

export async function getRecentChannels(providerId) {
    const vault = loadVault();
    return (vault.recentChannels || [])
        .filter(c => !providerId || c.provider_id === providerId)
        .slice(0, 20);
}

export async function registerEPGSync() {
    return { success: true };
}

export async function getCachedEPG(streamId, providerId) {
    const epgMap = (await getProviderStoreData('epg_listings', providerId)) || {};
    return { epg_listings: epgMap[streamId] || [] };
}

export async function getCachedEPGBatch(streamIds = [], providerId) {
    const epgMap = (await getProviderStoreData('epg_listings', providerId)) || {};
    const out = {};
    for (const id of streamIds) {
        if (epgMap[id]) out[id] = epgMap[id];
    }
    return out;
}

export async function getEPGSyncStatus() {
    return { isSyncing: false };
}

export async function resetEPG() {
    await clearCatalogDb(['epg_listings']);
    return { success: true };
}

export async function resetMetadata() {
    const vault = loadVault();
    vault.metadataOverrides = {};
    saveVault(vault);
    return { success: true };
}

export async function resetWatchHistory() {
    const vault = loadVault();
    vault.watchHistory = [];
    vault.recentChannels = [];
    saveVault(vault);
    return { success: true };
}

export async function factoryReset() {
    localStorage.removeItem(getStorageKey());
    await clearCatalogDb();
    return { success: true };
}

export async function triggerMetadataScan() {
    return { success: true, updated: 0, count: 0 };
}
