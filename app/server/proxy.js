const NodeCache = require('node-cache');
const http = require('http');
const https = require('https');
const { request } = require('./httpClient');

// Keep-Alive Agents to prevent premature stream closure
const httpAgent = new http.Agent({ keepAlive: true, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 60000 });

// Cache for 15 minutes, check for deletions every 2 minutes
const apiCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const GENERIC_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function getProfile(db, profileId) {
    if (!profileId) return null;
    try {
        return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    } catch (e) {
        return null;
    }
}

function getProvider(db, providerId) {
    if (!providerId) {
        return null;
    }

    return db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
}

function getKnownM3UUrls(db, providerId) {
    if (!providerId) {
        return new Set();
    }

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`m3u_urls_${providerId}`);
    if (!row || !row.value) {
        return new Set();
    }

    try {
        return new Set(Object.values(JSON.parse(row.value)));
    } catch (error) {
        return new Set();
    }
}

function authorizeProxyTarget(db, req, decodedUrl, decryptSecret) {
    const provider = getProvider(db, req.user?.providerId);
    if (!provider) {
        return { allowed: false, error: 'Provider not found for active session' };
    }

    if (provider.type === 'm3u') {
        const knownUrls = getKnownM3UUrls(db, provider.id);
        if (!knownUrls.has(decodedUrl)) {
            console.error(`[Proxy] Blocked M3U proxy target outside imported playlist: ${decodedUrl}`);
            return { allowed: false, error: 'Proxying arbitrary playlist targets is forbidden' };
        }

        return { allowed: true, provider, url: decodedUrl };
    }

    let serverUrl;
    let targetUrl;
    try {
        serverUrl = new URL(req.user?.serverUrl || provider.url);
        targetUrl = new URL(decodedUrl);
    } catch (error) {
        return { allowed: false, error: 'Invalid proxy target URL' };
    }

    const providerPath = serverUrl.pathname.replace(/\/$/, '');
    const isSameProvider = targetUrl.origin === serverUrl.origin
        && (!providerPath || targetUrl.pathname === providerPath || targetUrl.pathname.startsWith(`${providerPath}/`));
    if (!isSameProvider) {
        console.error(`[Proxy] Blocked attempt to proxy outside provider origin ${serverUrl.origin}.`);
        return { allowed: false, error: 'Proxying arbitrary domains is forbidden' };
    }

    // Resolve Password from Profile, Session, or Provider (Fallback)
    let password = req.user.password;
    if (req.user.profileId) {
        const profile = getProfile(db, req.user.profileId);
        if (profile && profile.password) {
            password = decryptSecret(profile.password);
        }
    }

    if (!password && req.user.providerId) {
        const providerData = getProvider(db, req.user.providerId);
        // If it's a generic provider session and we don't have a password in session,
        // we might need to look up if there's a default or if we should have had it.
        // For now, let's ensure we log why it's missing.
        if (!password) {
            console.warn(`[Proxy] No password found for profile ${req.user.profileId} or session.`);
        }
    }

    if (!password) {
        return { allowed: false, error: 'User credentials not available for proxy' };
    }

    let finalUrl = decodedUrl;
    const missingPassSequence = `/${req.user.username}//`;
    if (finalUrl.includes(missingPassSequence)) {
        finalUrl = finalUrl.replace(missingPassSequence, `/${req.user.username}/${encodeURIComponent(password)}/`);
    }

    if (finalUrl.includes('player_api.php')) {
        // Ensure password is injected even if provided blank in client request
        if (!finalUrl.includes('password=')) {
            finalUrl += (finalUrl.includes('?') ? '&' : '?') + `password=${encodeURIComponent(password)}`;
        } else {
            finalUrl = finalUrl.replace(/password=(?=&|$)/, `password=${encodeURIComponent(password)}`);
            finalUrl = finalUrl.replace(/password=[^&]*/, `password=${encodeURIComponent(password)}`);
        }
    }

    return { allowed: true, provider, url: finalUrl };
}

const createStreamProxy = (db, decryptSecret) => async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('Missing "url" query parameter');
    }

    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(url);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid URL encoding' });
    }
    const authResult = authorizeProxyTarget(db, req, decodedUrl, decryptSecret);
    if (!authResult.allowed) {
        return res.status(403).json({ error: authResult.error });
    }

    const profile = getProfile(db, req.user?.profileId);
    const profileUserAgent = profile?.user_agent || null;

    const finalUrl = authResult.url;
    let redactedTarget = authResult.provider.url;
    try {
        const safeUrl = new URL(finalUrl);
        safeUrl.username = '';
        safeUrl.password = '';
        safeUrl.searchParams.delete('username');
        safeUrl.searchParams.delete('password');
        redactedTarget = safeUrl.toString();
    } catch (error) { /* target was already validated */ }
    console.log(`[Proxy] ${profile ? `[Profile: ${profile.name}] ` : ''}${redactedTarget}`);

    const isApiCall = finalUrl.includes('player_api.php');
    let cacheKey = finalUrl;

    if (isApiCall) {
        try {
            const urlObj = new URL(finalUrl);
            const action = urlObj.searchParams.get('action');
            const sharedActions = ['get_short_epg', 'get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_series_categories', 'get_vod_streams', 'get_series', 'get_series_info'];

            if (sharedActions.includes(action)) {
                urlObj.searchParams.delete('username');
                urlObj.searchParams.delete('password');
                const sessionScope = req.user?.profileId || req.user?.username || authResult.provider.id;
                cacheKey = `${authResult.provider.id}:${sessionScope}:${urlObj.toString()}`;
                console.log(`[Proxy Cache] Scoped key prepared for ${action} on ${urlObj.host}`);
            }
        } catch (error) {
            cacheKey = finalUrl;
        }
    }

    if (isApiCall) {
        const cachedData = apiCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache Hit] ${cacheKey}`);
            res.setHeader('Content-Type', 'application/json');
            return res.send(cachedData);
        }
    }

    const controller = new AbortController();
    req.on('close', () => {
        controller.abort();
    });

    try {
        const inboundUserAgent = req.headers['user-agent'];

        if (isApiCall) {
            const response = await request({
                method: 'get',
                url: finalUrl,
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                },
                timeout: 10000,
            });

            apiCache.set(cacheKey, response.data);
            return res.json(response.data);
        }

        const buildStreamHeaders = (fallbackUserAgent, includeRange = true) => {
            const headers = {
                Accept: '*/*',
            };

            if (includeRange && req.headers.range) {
                headers.Range = req.headers.range;
            }
            if (includeRange && req.headers['if-range']) {
                headers['If-Range'] = req.headers['if-range'];
            }
            if (req.headers['accept-language']) {
                headers['Accept-Language'] = req.headers['accept-language'];
            }
            
            // Priority: Profile Custom UA > M3PrismCore
            // We do NOT use the browser User-Agent for streams as many IPTV providers return fake redirects (zaypool.win) to ban browser scraping of .ts segments
            const finalUA = profileUserAgent || fallbackUserAgent || 'VLC/3.0.16 LibVLC/3.0.16';
            headers['User-Agent'] = finalUA;

            return headers;
        };

        const fetchStream = async (headers) => request({
            method: 'get',
            url: finalUrl,
            responseType: 'stream',
            signal: controller.signal,
            httpAgent,
            httpsAgent,
            maxRedirects: 5,
            headers,
        });

        let response;
        try {
            response = await fetchStream(buildStreamHeaders(null));
        } catch (error) {
            const status = error.response?.status;
            const shouldRetryWithBrowserUA = (status === 403 || status >= 500) && inboundUserAgent;
            const shouldRetryWithoutRange = status >= 500 && !!req.headers.range;

            if (shouldRetryWithBrowserUA) {
                console.warn(`[Proxy] Retrying stream with inbound browser user-agent after upstream status ${status}.`);
                try {
                    response = await fetchStream(buildStreamHeaders(inboundUserAgent));
                } catch (retryError) {
                    if (retryError.response?.status >= 500 && shouldRetryWithoutRange) {
                        console.warn('[Proxy] Retrying stream without Range header after repeated upstream 5xx.');
                        response = await fetchStream(buildStreamHeaders(inboundUserAgent, false));
                    } else {
                        throw retryError;
                    }
                }
            } else if (shouldRetryWithoutRange) {
                console.warn('[Proxy] Retrying stream without Range header after upstream 5xx.');
                response = await fetchStream(buildStreamHeaders(GENERIC_BROWSER_USER_AGENT, false));
            } else {
                throw error;
            }
        }

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        response.data.on('error', (error) => {
            console.error('Stream processing error:', error.message);
            if (!res.headersSent) {
                res.status(500).end();
            }
            controller.abort();
        });

        response.data.pipe(res);
    } catch (error) {
        if (error.name === 'CanceledError' || error.name === 'AbortError') {
            console.log(`[Proxy] Client disconnected from ${finalUrl}`);
            return;
        }

        console.error(`Proxy Error (${error.response?.status || 'no-status'}):`, error.message);
        if (!res.headersSent) {
            res.status(error.response?.status || 502).send('Error fetching data');
        }
    }
};

module.exports = createStreamProxy;
