import { useState, useEffect, useCallback } from 'react';
import { authenticateUser, registerEPGSync, verifySession, logoutUser, getSetupStatus } from '../api/api';
import { AuthContext } from './auth-context';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [currentProvider, setCurrentProvider] = useState(null);
    const [activeProfile, setActiveProfile] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isConfigured, setIsConfigured] = useState(true);
    const [hasProviders, setHasProviders] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [setupMode, setSetupMode] = useState(null);

    const [hiddenChannels, setHiddenChannels] = useState(() => {
        const saved = localStorage.getItem('hidden_channels');
        return saved ? JSON.parse(saved) : [];
    });
    const [hiddenCategories, setHiddenCategories] = useState(() => {
        const saved = localStorage.getItem('hidden_categories');
        return saved ? JSON.parse(saved) : [];
    });

    useEffect(() => {
        localStorage.setItem('hidden_channels', JSON.stringify(hiddenChannels));
    }, [hiddenChannels]);

    useEffect(() => {
        localStorage.setItem('hidden_categories', JSON.stringify(hiddenCategories));
    }, [hiddenCategories]);

    const establishSession = (userInfo, providerInfo, profileInfo) => {
        if (!userInfo || !providerInfo) return;

        const sanitizedUser = { ...userInfo, password: '' };
        setUser(sanitizedUser);
        setCurrentProvider(providerInfo);
        setActiveProfile(profileInfo || null);
        setIsAuthenticated(true);
        
        localStorage.setItem('iptv_user', JSON.stringify(sanitizedUser));
        localStorage.setItem('iptv_provider', JSON.stringify(providerInfo));
        if (profileInfo) localStorage.setItem('iptv_active_profile', JSON.stringify(profileInfo));
    };

    const clearStoredSession = () => {
        setUser(null);
        setCurrentProvider(null);
        setActiveProfile(null);
        setIsAuthenticated(false);
        localStorage.removeItem('iptv_user');
        localStorage.removeItem('iptv_provider');
        localStorage.removeItem('iptv_active_profile');
    };

    const refreshSetupStatus = useCallback(async () => {
        try {
            const setupStatus = await getSetupStatus();
            const providersExist = !!(setupStatus && setupStatus.providerCount > 0);
            const profilesExist = !!(setupStatus && setupStatus.profileCount > 0);
            
            setHasProviders(providersExist);
            setIsLocked(providersExist && !profilesExist);
            setIsConfigured(setupStatus?.configured ?? false);
            setSetupMode(setupStatus?.mode);
            
            return setupStatus;
        } catch (e) {
            console.error("[Auth] Setup check failed:", e);
            return null;
        }
    }, []);

    useEffect(() => {
        const initSession = async () => {
            const safetyTimeout = setTimeout(() => setLoading(false), 5000);

            try {
                const setupStatus = await refreshSetupStatus();

                if (!setupStatus || !setupStatus.configured) {
                    setIsConfigured(false);
                    clearStoredSession();
                    return;
                }

                const session = await verifySession();
                if (session && session.user && session.provider) {
                    establishSession(session.user, session.provider, session.profile);
                } else {
                    clearStoredSession();
                }
            } catch {
                clearStoredSession();
            } finally {
                clearTimeout(safetyTimeout);
                setLoading(false);
            }
        };
        initSession();
    }, [refreshSetupStatus]);

    const toggleHideChannel = (streamId) => {
        setHiddenChannels(prev =>
            prev.includes(streamId) ? prev.filter(id => id !== streamId) : [...prev, streamId]
        );
    };

    const toggleHideCategory = (catId) => {
        setHiddenCategories(prev =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    };

    const login = async (provider, username, password, profileName) => {
        setLoading(true);
        try {
            const data = await authenticateUser(provider.id, username, password, profileName);
            if (data && data.success) {
                const activeProvider = data.provider || provider;
                // Immediately update context with user/provider/profile from the response
                establishSession(data.user_info, activeProvider, data.profile);
                
                // CRITICAL: Refresh setup status immediately so isLocked flips to false
                await refreshSetupStatus();

                if ((activeProvider.type || 'xtream') !== 'm3u') {
                    registerEPGSync(activeProvider.id, { username, password })
                    .catch(e => console.warn('EPG sync registration failed:', e));
                }

                return { success: true };
            } else {
                return { success: false, message: 'Invalid Credentials' };
            }
        } catch (error) {
            return { success: false, message: error.message };
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        await logoutUser();
        clearStoredSession();
        await refreshSetupStatus();
    };

    const updateProvider = (newData) => {
        setCurrentProvider(prev => {
            const updated = { ...prev, ...newData };
            localStorage.setItem('iptv_provider', JSON.stringify(updated));
            return updated;
        });
    };

    return (
        <AuthContext.Provider value={{
            user,
            currentProvider,
            activeProfile,
            isAuthenticated,
            isConfigured,
            hasProviders,
            isLocked,
            setupMode,
            login,
            logout,
            establishSession,
            refreshSetupStatus,
            updateProvider,
            loading,
            hiddenChannels,
            hiddenCategories,
            toggleHideChannel,
            toggleHideCategory
        }}>
            {children}
        </AuthContext.Provider>
    );
};
