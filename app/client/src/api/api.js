import axios from 'axios';
import * as serverless from './serverlessAdapter';

const API_BASE_URL = '/api';

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

let backendMode = serverless.isPortfoliOSHosted() ? 'serverless' : null;

export const isServerlessMode = () => backendMode === 'serverless' || serverless.isPortfoliOSHosted();
export const getNativeRelay = serverless.getNativeRelay;
export const isNativeRelayAvailable = serverless.isNativeRelayAvailable;
export const relayFetch = serverless.relayFetch;
export const resolveStreamUrlForPlayback = serverless.resolveStreamUrlForPlayback;

async function withAdapter(serverCall, serverlessCall) {
    if (isServerlessMode()) {
        return serverlessCall();
    }
    try {
        const res = await serverCall();
        backendMode = 'server';
        return res;
    } catch (error) {
        if (!error.response || error.response.status === 404 || error.response.status === 502 || error.response.status === 504) {
            backendMode = 'serverless';
            return serverlessCall();
        }
        throw error;
    }
}

export const checkServerStatus = async () => {
    return withAdapter(
        async () => {
            const response = await api.get('/status');
            if (typeof response.data !== 'object' || response.data === null) {
                throw new Error('Invalid status response');
            }
            return response.data;
        },
        () => serverless.checkServerStatus()
    );
};

export const getProviders = async () => {
    return withAdapter(
        async () => (await api.get('/providers')).data,
        () => serverless.getProviders()
    );
};

export const createProvider = async (provider) => {
    return withAdapter(
        async () => (await api.post('/providers', provider)).data,
        () => serverless.createProvider(provider)
    );
};

export const updateProvider = async (providerId, data) => {
    return withAdapter(
        async () => (await api.put(`/providers/${providerId}`, data)).data,
        () => serverless.updateProvider(providerId, data)
    );
};

export const deleteProvider = async (providerId) => {
    return withAdapter(
        async () => (await api.delete(`/providers/${providerId}`)).data,
        () => serverless.deleteProvider(providerId)
    );
};

export const testProviderConnection = async (url, username, password) => {
    return withAdapter(
        async () => (await api.post('/providers/test', { url, username, password })).data,
        () => serverless.testProviderConnection(url, username, password)
    );
};

export const importM3U = async (url, providerId, name) => {
    return withAdapter(
        async () => (await api.post('/import/m3u', { url, providerId, name })).data,
        () => serverless.importM3U(url, providerId, name)
    );
};

export const updateTimeshift = async (providerId, timeshift) => {
    return withAdapter(
        async () => (await api.put(`/providers/${providerId}/timeshift`, { timeshift })).data,
        () => serverless.updateTimeshift(providerId, timeshift)
    );
};

export const globalSearch = async (query, providerId) => {
    if (isServerlessMode()) {
        return serverless.globalSearch(query, providerId);
    }
    try {
        const response = await api.get('/search', { params: { q: query, providerId } });
        return response.data;
    } catch {
        return serverless.globalSearch(query, providerId);
    }
};

export const authenticateUser = async (providerId, username, password, profileName) => {
    if (isServerlessMode()) {
        return serverless.authenticateUser(providerId, username, password, profileName);
    }
    try {
        const response = await api.post('/auth/login', { providerId, username, password, profileName });
        return response.data;
    } catch (error) {
        if (!error.response || error.response.status === 404) {
            backendMode = 'serverless';
            return serverless.authenticateUser(providerId, username, password, profileName);
        }
        console.error('Auth Error:', error);
        throw new Error(error.response?.data?.error || 'Authentication failed');
    }
};

export const logoutUser = async () => {
    if (isServerlessMode()) {
        return serverless.logoutUser();
    }
    try {
        await api.post('/auth/logout');
    } catch {
        // Local session state is still cleared when the backend is unavailable.
    }
    await serverless.logoutUser();
};

export const verifySession = async () => {
    if (isServerlessMode()) {
        return serverless.verifySession();
    }
    try {
        const response = await api.get('/auth/me');
        if (typeof response.data !== 'object') return serverless.verifySession();
        return response.data;
    } catch {
        return isServerlessMode() ? serverless.verifySession() : null;
    }
};

export const fetchXtreamData = async (providerUrl, params) => {
    if (isServerlessMode()) {
        return serverless.fetchXtreamData(providerUrl, params);
    }
    try {
        const baseUrl = providerUrl.endsWith('/') ? providerUrl.slice(0, -1) : providerUrl;
        const queryString = new URLSearchParams(params).toString();
        const targetUrl = `${baseUrl}/player_api.php?${queryString}`;
        const response = await api.get('/proxy', {
            params: { url: targetUrl }
        });
        return response.data;
    } catch (error) {
        if (!error.response || error.response.status === 404) {
            backendMode = 'serverless';
            return serverless.fetchXtreamData(providerUrl, params);
        }
        console.error('Xtream Data Fetch Error:', error);
        return [];
    }
};

export const fetchSeriesInfo = async (providerUrl, userInfo, seriesId) => {
    return fetchXtreamData(providerUrl, {
        username: userInfo.username,
        password: userInfo.password,
        action: 'get_series_info',
        series_id: seriesId
    });
};

export const getProxyConfig = async () => {
    if (isServerlessMode()) return { enabled: true, mode: 'portfolios-relay' };
    const response = await api.get('/config/proxy');
    return response.data;
};

export const syncAllData = async (providerId, user) => {
    return withAdapter(
        async () => (await api.post('/sync/all', { providerId, user })).data,
        () => serverless.syncAllData(providerId, user)
    );
};

export const fetchCachedChannels = async (providerId, categoryId) => {
    return withAdapter(
        async () => (await api.get('/channels', { params: { providerId, categoryId } })).data,
        () => serverless.fetchCachedChannels(providerId, categoryId)
    );
};

export const fetchCachedCategories = async (providerId) => {
    return withAdapter(
        async () => (await api.get('/categories', { params: { providerId } })).data,
        () => serverless.fetchCachedCategories(providerId)
    );
};

export const fetchCachedVodCategories = async (providerId, type) => {
    return withAdapter(
        async () => (await api.get('/vod/categories', { params: { providerId, type } })).data,
        () => serverless.fetchCachedVodCategories(providerId, type)
    );
};

export const fetchCachedVodItems = async (providerId, type, categoryId) => {
    return withAdapter(
        async () => (await api.get('/vod/items', { params: { providerId, type, categoryId } })).data,
        () => serverless.fetchCachedVodItems(providerId, type, categoryId)
    );
};

// Helper to get proxied asset URL (for icons/posters)
export const getAssetUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (isServerlessMode()) return url;
    return `${API_BASE_URL}/assets?url=${encodeURIComponent(url)}`;
};

export const saveWatchProgress = async (userId, streamId, type, parentId, name, poster, time, duration) => {
    return withAdapter(
        async () => {
            await api.post('/progress', { userId, streamId, type, parentId, name, poster, time, duration });
        },
        () => serverless.saveWatchProgress(userId, streamId, type, parentId, name, poster, time, duration)
    );
};

export const getWatchProgress = async (userId, streamId) => {
    return withAdapter(
        async () => (await api.get(`/progress/${userId}/${streamId}`)).data,
        () => serverless.getWatchProgress(userId, streamId)
    );
};

export const getContinueWatchingList = async (userId, type) => {
    return withAdapter(
        async () => (await api.get(`/progress/list/${userId}/${type}`)).data,
        () => serverless.getContinueWatchingList(userId, type)
    );
};

export const registerEPGSync = async (providerId, user) => {
    if (isServerlessMode()) return serverless.registerEPGSync(providerId, user);
    try {
        const response = await api.post('/epg/register', { providerId, user });
        return response.data;
    } catch (error) {
        console.error('EPG Sync Registration Error:', error);
        return { success: false };
    }
};

export const getCachedEPG = async (streamId, providerId) => {
    if (isServerlessMode()) return serverless.getCachedEPG(streamId, providerId);
    try {
        const response = await api.get(`/epg/${streamId}`, { params: { providerId } });
        return response.data;
    } catch {
        return { epg_listings: [] };
    }
};

export const getCachedEPGBatch = async (streamIds, providerId) => {
    if (isServerlessMode()) return serverless.getCachedEPGBatch(streamIds, providerId);
    try {
        const response = await api.post('/epg/batch', { streamIds, providerId });
        return response.data;
    } catch {
        return {};
    }
};

export const getEPGSyncStatus = async () => {
    if (isServerlessMode()) return serverless.getEPGSyncStatus();
    try {
        const response = await api.get('/epg/status');
        return response.data;
    } catch {
        return { isSyncing: false };
    }
};

export const getDirectStreamUrl = (url) => {
    if (isServerlessMode()) return serverless.resolveStreamUrlForPlayback(url);
    return `${API_BASE_URL}/stream/direct?url=${encodeURIComponent(url)}`;
};

export const getSetupStatus = async () => {
    return withAdapter(
        async () => {
            const response = await api.get('/setup/status');
            if (typeof response.data !== 'object' || response.data === null || typeof response.data.configured !== 'boolean') {
                throw new Error('Invalid setup status response');
            }
            return response.data;
        },
        () => serverless.getSetupStatus()
    );
};

export const getRuntimeConfig = async () => {
    return withAdapter(
        async () => (await api.get('/runtime/config')).data,
        () => serverless.getRuntimeConfig()
    );
};

export const updateRuntimeConfig = async (config) => {
    return withAdapter(
        async () => (await api.put('/runtime/config', config)).data,
        () => serverless.updateRuntimeConfig(config)
    );
};

export const getProfiles = async () => {
    return withAdapter(
        async () => (await api.get('/profiles')).data,
        () => serverless.getProfiles()
    );
};

export const createProfile = async (profile) => {
    return withAdapter(
        async () => (await api.post('/profiles', profile)).data,
        () => serverless.createProfile(profile)
    );
};

export const activateProfile = async (profileId) => {
    return withAdapter(
        async () => (await api.put(`/profiles/${profileId}/activate`)).data,
        () => serverless.activateProfile(profileId)
    );
};

export const deleteProfile = async (profileId) => {
    return withAdapter(
        async () => (await api.delete(`/profiles/${profileId}`)).data,
        () => serverless.deleteProfile(profileId)
    );
};

export const updateProfile = async (profileId, data) => {
    return withAdapter(
        async () => (await api.put(`/profiles/${profileId}`, data)).data,
        () => serverless.updateProfile(profileId, data)
    );
};

export const getProfileCredentials = async (profileId) => {
    return withAdapter(
        async () => (await api.get(`/profiles/${profileId}/credentials`)).data,
        () => serverless.getProfileCredentials(profileId)
    );
};

export const loginWithProfile = async (profileId) => {
    return withAdapter(
        async () => (await api.post(`/profiles/${profileId}/login`)).data,
        () => serverless.loginWithProfile(profileId)
    );
};

export const getLiveStreamUrl = async (streamId, providerId) => {
    return withAdapter(
        async () => (await api.get(`/streams/live/${streamId}`, { params: { providerId } })).data.url,
        () => serverless.getLiveStreamUrl(streamId, providerId)
    );
};

export const factoryReset = async () => {
    return withAdapter(
        async () => (await api.post('/factory-reset')).data,
        () => serverless.factoryReset()
    );
};

export const resetEPG = async () => {
    return withAdapter(
        async () => (await api.post('/reset/epg')).data,
        () => serverless.resetEPG()
    );
};

export const resetMetadata = async () => {
    return withAdapter(
        async () => (await api.post('/reset/metadata')).data,
        () => serverless.resetMetadata()
    );
};

export const resetWatchHistory = async () => {
    return withAdapter(
        async () => (await api.post('/reset/history')).data,
        () => serverless.resetWatchHistory()
    );
};

export const toggleFavorite = async (itemId, itemType, name, poster, providerId) => {
    return withAdapter(
        async () => (await api.post('/favorites/toggle', { itemId, itemType, name, poster, providerId })).data,
        () => serverless.toggleFavorite(itemId, itemType, name, poster, providerId)
    );
};

export const getFavorites = async (type, providerId) => {
    return withAdapter(
        async () => (await api.get('/favorites', { params: { type, providerId } })).data,
        () => serverless.getFavorites(type, providerId)
    );
};

export const checkFavorite = async (itemId, itemType) => {
    return withAdapter(
        async () => (await api.get('/favorites/check', { params: { itemId, itemType } })).data,
        () => serverless.checkFavorite(itemId, itemType)
    );
};

export const recordRecentChannel = async (streamId, name, streamIcon, providerId) => {
    if (isServerlessMode()) {
        await serverless.recordRecentChannel(streamId, name, streamIcon, providerId);
        return;
    }
    try {
        await api.post('/recent-channels', { streamId, name, streamIcon, providerId });
    } catch { /* Recent-channel tracking is best effort. */ }
};

export const getRecentChannels = async (providerId) => {
    if (isServerlessMode()) {
        return serverless.getRecentChannels(providerId);
    }
    try {
        const response = await api.get('/recent-channels', { params: { providerId } });
        return response.data;
    } catch {
        return [];
    }
};

export const getContinueWatching = async (type) => {
    if (isServerlessMode()) {
        return serverless.getContinueWatching(type);
    }
    try {
        const response = await api.get('/continue-watching', { params: { type } });
        return response.data;
    } catch {
        return [];
    }
};

export const triggerMetadataScan = async () => {
    return withAdapter(
        async () => (await api.post('/metadata/scan')).data,
        () => serverless.triggerMetadataScan()
    );
};

export default api;
