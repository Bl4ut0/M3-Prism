import { useState, useEffect } from 'react';
import { syncAllData, updateTimeshift, resetEPG, resetMetadata, resetWatchHistory, factoryReset, getProfiles, deleteProfile, getRuntimeConfig, updateRuntimeConfig, updateProfile, triggerMetadataScan, fetchCachedCategories, fetchCachedVodCategories } from '../api/api';
import { useAuth } from '../context/auth-context';
import { 
    Shield, Monitor, Save, RefreshCw, Database, Clock, Trash2, AlertTriangle,
    User, Loader2, Check, WifiOff, Palette, Film, Sparkles, Filter, X
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import SplashLoadingScreen from '../components/SplashLoadingScreen';

const Settings = () => {
    const { user, currentProvider, updateProvider, logout, hiddenCategories, toggleHideCategory } = useAuth();
    const navigate = useNavigate();
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);

    // EPG Filtering State
    const [showCategoryFilter, setShowCategoryFilter] = useState(false);
    const [loadingCategories, setLoadingCategories] = useState(false);
    const [filterCats, setFilterCats] = useState({ live: [], movie: [], series: [] });
    const [filterTab, setFilterTab] = useState('live');

    // Timeshift state
    const [timeshift, setTimeshift] = useState(currentProvider?.timeshift || 0);

    // Reset states
    const [resetLoading, setResetLoading] = useState({ epg: false, metadata: false, history: false });
    const [resetSuccess, setResetSuccess] = useState({ epg: false, metadata: false, history: false });

    // Factory reset
    const [showFactoryReset, setShowFactoryReset] = useState(false);
    const [resetConfirmText, setResetConfirmText] = useState('');
    const [isResetting, setIsResetting] = useState(false);

    // Profiles
    const [profiles, setProfiles] = useState([]);
    const [loadingProfiles, setLoadingProfiles] = useState(true);
    const [editingProfile, setEditingProfile] = useState(null);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Runtime configuration
    const [runtimeConfig, setRuntimeConfig] = useState({ tmdbApiKey: '', userAgent: 'WebPlayer/2.0', configPath: '' });
    const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false);
    const [runtimeConfigSaved, setRuntimeConfigSaved] = useState(false);

    // Metadata scan
    const [isScanning, setIsScanning] = useState(false);
    const [scanResult, setScanResult] = useState(null);

    useEffect(() => {
        loadProfiles();
        loadRuntimeConfig();
    }, []);

    const loadProfiles = async () => {
        setLoadingProfiles(true);
        const list = await getProfiles();
        setProfiles(list);
        setLoadingProfiles(false);
    };

    const loadRuntimeConfig = async () => {
        try {
            const config = await getRuntimeConfig();
            setRuntimeConfig({
                tmdbApiKey: config.tmdbApiKey || '',
                userAgent: config.userAgent || 'WebPlayer/2.0',
                configPath: config.configPath || '',
            });
        } catch (e) {
            console.error('Failed to load runtime config:', e);
        }
    };

    const handleTimeshiftChange = async (val) => {
        setTimeshift(val);
        if (currentProvider?.id) {
            try {
                await updateTimeshift(currentProvider.id, val);
                updateProvider({ timeshift: val });
            } catch (err) {
                console.error("Failed to update timeshift", err);
            }
        }
    };

    const handleSync = async () => {
        if (!user || !currentProvider) return;
        if (currentProvider.type === 'm3u') {
            setSyncStatus({ success: false, message: 'Re-import M3U playlists instead of running sync.' });
            return;
        }
        setIsSyncing(true);
        setSyncStatus(null);
        try {
            await syncAllData(currentProvider.id, user);
            setSyncStatus({ success: true, message: 'Synced successfully!' });
        } catch (err) {
            setSyncStatus({ success: false, message: 'Sync failed: ' + err.message });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSelectiveReset = async (type) => {
        setResetLoading(prev => ({ ...prev, [type]: true }));
        try {
            if (type === 'epg') await resetEPG();
            else if (type === 'metadata') await resetMetadata();
            else if (type === 'history') await resetWatchHistory();
            setResetSuccess(prev => ({ ...prev, [type]: true }));
            setTimeout(() => setResetSuccess(prev => ({ ...prev, [type]: false })), 3000);
        } catch (e) {
            console.error(`Reset ${type} failed:`, e);
        } finally {
            setResetLoading(prev => ({ ...prev, [type]: false }));
        }
    };

    const handleFactoryReset = async () => {
        if (resetConfirmText !== 'RESET') return;
        setIsResetting(true);
        try {
            await factoryReset();
            localStorage.clear();
            await logout();
            navigate('/onboarding');
        } catch (e) {
            console.error('Factory reset failed:', e);
            setIsResetting(false);
        }
    };

    const handleOpenCategoryFilter = async () => {
        setShowCategoryFilter(true);
        if (filterCats.live.length === 0) {
            setLoadingCategories(true);
            try {
                const pId = currentProvider?.id;
                if (!pId) return;
                const [live, movies, series] = await Promise.all([
                    fetchCachedCategories(pId).catch(() => []),
                    fetchCachedVodCategories(pId, 'movie').catch(() => []),
                    fetchCachedVodCategories(pId, 'series').catch(() => [])
                ]);
                setFilterCats({ live: live || [], movie: movies || [], series: series || [] });
            } catch (e) {
                console.error("Filter load error", e);
            } finally {
                setLoadingCategories(false);
            }
        }
    };

    const handleDeleteProfile = async (profileId) => {
        try {
            await deleteProfile(profileId);
            setProfiles(prev => prev.filter(p => p.id !== profileId));
        } catch (e) {
            console.error('Failed to delete profile:', e);
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        if (!editingProfile) return;
        setIsUpdatingProfile(true);
        try {
            await updateProfile(editingProfile.id, {
                name: editingProfile.name,
                user_agent: editingProfile.user_agent,
                timeshift: editingProfile.timeshift
            });
            await loadProfiles();
            setEditingProfile(null);
        } catch (e) {
            console.error('Failed to update profile:', e);
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleRuntimeConfigSave = async () => {
        setSavingRuntimeConfig(true);
        setRuntimeConfigSaved(false);
        try {
            const saved = await updateRuntimeConfig({
                tmdbApiKey: runtimeConfig.tmdbApiKey,
                userAgent: runtimeConfig.userAgent,
            });
            setRuntimeConfig({
                tmdbApiKey: saved.tmdbApiKey || '',
                userAgent: saved.userAgent || 'WebPlayer/2.0',
                configPath: saved.configPath || runtimeConfig.configPath,
            });
            setRuntimeConfigSaved(true);
            setTimeout(() => setRuntimeConfigSaved(false), 2500);
        } catch (e) {
            console.error('Failed to save runtime config:', e);
        } finally {
            setSavingRuntimeConfig(false);
        }
    };

    const SettingSection = ({ title, icon: Icon, iconColor = 'text-blue-400', children, danger }) => (
        <div className={clsx("mb-6 p-6 rounded-2xl border", danger ? "bg-red-500/[0.03] border-red-500/10" : "bg-white/[0.02] border-white/5")}>
            <div className="flex items-center mb-6">
                <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center mr-4", danger ? "bg-red-500/10" : "bg-blue-500/10")}>
                    <Icon className={clsx("w-5 h-5", danger ? "text-red-400" : iconColor)} />
                </div>
                <h3 className={clsx("text-lg font-bold", danger ? "text-red-400" : "text-white")}>{title}</h3>
            </div>
            <div className="space-y-5 pl-14">
                {children}
            </div>
        </div>
    );

    const ResetButton = ({ label, description, type, icon: Icon }) => (
        <div className="flex items-center justify-between py-3">
            <div className="flex-1 mr-4">
                <div className="font-medium text-white text-sm">{label}</div>
                <div className="text-xs text-zinc-500 mt-1">{description}</div>
            </div>
            <button
                onClick={() => handleSelectiveReset(type)}
                disabled={resetLoading[type]}
                className={clsx(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border",
                    resetSuccess[type]
                        ? "bg-green-500/10 border-green-500/20 text-green-400"
                        : "bg-white/5 border-white/10 text-zinc-400 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400"
                )}
            >
                {resetLoading[type] ? <Loader2 className="w-3 h-3 animate-spin" /> : resetSuccess[type] ? <Check className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                {resetSuccess[type] ? 'Cleared' : 'Clear'}
            </button>
        </div>
    );

    return (
        <>
            <SplashLoadingScreen isVisible={isScanning} message="SCANNING METADATA..." />
            <div className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
            <div className="p-8 max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-black text-white tracking-tight">Settings</h1>
                    <p className="text-zinc-500 text-sm mt-1">Manage your app, data, and playback preferences.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    {/* Data Management */}
                <SettingSection title="Data Management" icon={Database}>
                    <div className="flex items-center justify-between py-3">
                        <div className="flex-1 mr-4">
                            <div className="font-medium text-white text-sm">Refresh Provider Data</div>
                            <div className="text-xs text-zinc-500 mt-1">Re-downloads channels, categories, and EPG listings from your provider.</div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSync}
                                disabled={isSyncing}
                                className={clsx(
                                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                                    isSyncing ? "bg-white/5 text-zinc-600" : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                                )}
                            >
                                <RefreshCw className={clsx("w-3.5 h-3.5", isSyncing && "animate-spin")} />
                                {isSyncing ? 'Syncing...' : 'Sync Now'}
                            </button>
                            {syncStatus && (
                                <span className={clsx("text-xs font-medium", syncStatus.success ? "text-green-400" : "text-red-400")}>
                                    {syncStatus.message}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-white/5 pt-4">
                        <ResetButton label="EPG / Guide Data" description="Clears all cached TV guide listings. Will re-sync automatically." type="epg" icon={Clock} />
                        <ResetButton label="Artwork & Metadata" description="Removes TMDB poster overrides and clears the image cache." type="metadata" icon={Palette} />
                        <ResetButton label="Watch History" description="Clears all 'Continue Watching' progress and resume points." type="history" icon={Monitor} />
                    </div>
                </SettingSection>

                <SettingSection title="Content Filtering" icon={Filter}>
                    <div className="flex items-center justify-between py-3">
                        <div className="flex-1 mr-4">
                            <div className="font-medium text-white text-sm">Category Visibility</div>
                            <div className="text-xs text-zinc-500 mt-1">Hide specific Live TV, Movie, or Series groupings from your main library views.</div>
                        </div>
                        <button
                            onClick={handleOpenCategoryFilter}
                            className="bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-colors"
                        >
                            Select Categories
                        </button>
                    </div>
                </SettingSection>

                <SettingSection title="Application" icon={Film}>
                    <div className="space-y-4">
                        <div>
                            <div className="font-medium text-white text-sm">TMDB API Key</div>
                            <div className="text-xs text-zinc-500 mt-1">Used for metadata lookups, posters, backdrops, and logos.</div>
                        </div>
                        <input
                            type="text"
                            value={runtimeConfig.tmdbApiKey}
                            onChange={(e) => setRuntimeConfig(prev => ({ ...prev, tmdbApiKey: e.target.value }))}
                            placeholder="Optional, but required for metadata scanning"
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-700"
                        />

                        <div>
                            <div className="font-medium text-white text-sm">Outbound User-Agent</div>
                            <div className="text-xs text-zinc-500 mt-1">Applied to provider, metadata, proxy, and desktop webview requests.</div>
                        </div>
                        <input
                            type="text"
                            value={runtimeConfig.userAgent}
                            onChange={(e) => setRuntimeConfig(prev => ({ ...prev, userAgent: e.target.value }))}
                            placeholder="WebPlayer/2.0"
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-700"
                        />

                        <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
                            Config file: <span className="text-zinc-400 normal-case tracking-normal">{runtimeConfig.configPath || 'webplayer.config.json'}</span>
                        </div>

                        <button
                            onClick={handleRuntimeConfigSave}
                            disabled={savingRuntimeConfig}
                            className={clsx(
                                "flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all w-full sm:w-auto",
                                runtimeConfigSaved
                                    ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                    : "bg-blue-600 hover:bg-blue-500 text-white"
                            )}
                        >
                            {savingRuntimeConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : runtimeConfigSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                            {savingRuntimeConfig ? 'Saving...' : runtimeConfigSaved ? 'Saved' : 'Save Application Settings'}
                        </button>

                        <div className="border-t border-white/5 pt-5 mt-5">
                            <div className="flex items-center justify-between">
                                <div className="flex-1 mr-4">
                                    <div className="font-medium text-white text-sm flex items-center gap-2">
                                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                        Metadata Intelligence
                                    </div>
                                    <div className="text-xs text-zinc-500 mt-1">Scan your library to fetch HD posters & backdrops from TMDB. Requires a valid API key above.</div>
                                </div>
                                <button
                                    onClick={async () => {
                                        setIsScanning(true);
                                        setScanResult(null);
                                        try {
                                            const res = await triggerMetadataScan();
                                            setScanResult(res);
                                        } catch (e) {
                                            setScanResult({ success: false, error: e.message });
                                        } finally {
                                            setIsScanning(false);
                                        }
                                    }}
                                    disabled={isScanning}
                                    className={clsx(
                                        "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                                        isScanning ? "bg-white/5 text-zinc-600" : "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                                    )}
                                >
                                    {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                    {isScanning ? 'Scanning...' : 'Scan Library'}
                                </button>
                            </div>
                            {scanResult && (
                                <div className={clsx("mt-3 text-xs font-medium px-3 py-2 rounded-lg border", scanResult.success ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                                    {scanResult.success ? `Updated ${scanResult.updated} items (${scanResult.count} scanned)` : scanResult.error}
                                </div>
                            )}
                        </div>
                    </div>
                </SettingSection>

                {/* EPG & Guide */}
                <SettingSection title="EPG & Guide" icon={Clock}>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium text-white text-sm">Timeshift</div>
                                <div className="text-xs text-zinc-500 mt-1">Adjust guide data offset if the schedule is incorrect.</div>
                            </div>
                            <div className="text-xl font-mono font-bold text-blue-400 bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/20 min-w-[70px] text-center">
                                {timeshift > 0 ? `+${timeshift}` : timeshift}h
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-[10px] text-zinc-600 font-bold">-12h</span>
                            <input
                                type="range" min="-12" max="12" step="1" value={timeshift}
                                onChange={(e) => handleTimeshiftChange(parseInt(e.target.value))}
                                className="flex-1 h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-blue-500"
                            />
                            <span className="text-[10px] text-zinc-600 font-bold">+12h</span>
                        </div>
                        <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold text-center">
                            Applied to: <span className="text-blue-500/60">{currentProvider?.name || 'No Provider'}</span>
                        </div>
                    </div>
                </SettingSection>

                {/* Network & Security */}
                <SettingSection title="Network & Security" icon={Shield}>
                    <div className="flex items-center justify-between py-3">
                        <div className="flex-1 mr-4">
                            <div className="font-medium text-white text-sm flex items-center gap-2">
                                <WifiOff className="w-3.5 h-3.5 text-zinc-500" />
                                VPN / Tailscale Status
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">Secure network detection for private streaming.</div>
                        </div>
                        <div className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-zinc-800 border border-zinc-700 text-zinc-500">
                            Not Configured
                        </div>
                    </div>
                </SettingSection>

                {/* Profile Management */}
                <SettingSection title="Profile Management" icon={User}>
                    {loadingProfiles ? (
                        <div className="flex items-center gap-3 py-4 text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Loading profiles...</span>
                        </div>
                    ) : profiles.length === 0 ? (
                        <div className="py-4">
                            <p className="text-sm text-zinc-500 mb-4">No saved profiles yet. Profiles are created when you sign in.</p>
                            <button
                                onClick={() => navigate('/login')}
                                className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white transition-all"
                            >
                                Add Profile
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {profiles.map(profile => (
                                <div key={profile.id} className="flex items-center justify-between p-4 bg-white/[0.02] rounded-xl border border-white/5 group">
                                    <div className="flex items-center gap-4">
                                        <div className={clsx(
                                            "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black",
                                            profile.is_active ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
                                        )}>
                                            {profile.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-white flex items-center gap-2">
                                                {profile.name}
                                                {profile.is_active === 1 && (
                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                                                {profile.type} - {profile.username || 'M3U Playlist'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setEditingProfile(profile)}
                                            className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/10 text-zinc-500 hover:text-white transition-all"
                                        >
                                            <Save className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteProfile(profile.id)}
                                            className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            <button
                                onClick={() => navigate('/login')}
                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-white/10 text-zinc-500 hover:text-white hover:border-white/20 transition-all text-sm font-medium"
                            >
                                + Add Profile
                            </button>
                        </div>
                    )}
                </SettingSection>

                {/* Danger Zone */}
                <SettingSection title="Danger Zone" icon={AlertTriangle} danger>
                    <div className="space-y-4">
                        <div>
                            <div className="font-medium text-white text-sm">Factory Reset</div>
                            <div className="text-xs text-zinc-500 mt-1">
                                Permanently deletes <strong>all</strong> data: profiles, providers, channels, EPG, watch history, artwork cache, and settings. The app will return to the initial setup screen.
                            </div>
                        </div>
                        <button
                            onClick={() => setShowFactoryReset(true)}
                            className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                        >
                            Factory Reset
                        </button>
                    </div>
                </SettingSection>
                </div>

                <div className="text-center text-[10px] text-zinc-700 uppercase tracking-widest font-bold py-8">
                    M3 Prism Desktop - v1.1.0
                </div>
            </div>

            {/* Factory Reset Confirmation Modal */}
            <AnimatePresence>
                {showFactoryReset && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[200] flex items-center justify-center p-6"
                        onClick={() => !isResetting && setShowFactoryReset(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-zinc-900 border border-red-500/20 p-8 rounded-3xl w-full max-w-md shadow-3xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                                    <AlertTriangle className="w-6 h-6 text-red-500" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Factory Reset</h3>
                                    <p className="text-xs text-zinc-500">This action cannot be undone.</p>
                                </div>
                            </div>

                            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                                This will permanently erase all profiles, provider configurations, channels, guide data, watch history, and cached artwork. The application will restart at the setup screen.
                            </p>

                            <div className="mb-6">
                                <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold block mb-2">
                                    Type <span className="text-red-400">RESET</span> to confirm
                                </label>
                                <input
                                    type="text"
                                    value={resetConfirmText}
                                    onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
                                    placeholder="RESET"
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-lg font-bold tracking-[0.3em] focus:outline-none focus:border-red-500/50 transition-colors placeholder:text-zinc-700"
                                    disabled={isResetting}
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setShowFactoryReset(false); setResetConfirmText(''); }}
                                    disabled={isResetting}
                                    className="flex-1 px-5 py-3 rounded-xl text-sm font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleFactoryReset}
                                    disabled={resetConfirmText !== 'RESET' || isResetting}
                                    className={clsx(
                                        "flex-1 px-5 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                                        resetConfirmText === 'RESET' && !isResetting
                                            ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20"
                                            : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                    )}
                                >
                                    {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    {isResetting ? 'Resetting...' : 'Erase Everything'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Profile Edit Modal */}
            <AnimatePresence>
                {editingProfile && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[200] flex items-center justify-center p-6"
                        onClick={() => !isUpdatingProfile && setEditingProfile(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-zinc-900 border border-white/10 p-8 rounded-[2.5rem] w-full max-w-lg shadow-3xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 font-black">
                                    {editingProfile.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">Edit Profile</h3>
                                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Profile Specific Settings</p>
                                </div>
                            </div>

                            <form onSubmit={handleUpdateProfile} className="space-y-6">
                                <div>
                                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold block mb-2">Display Name</label>
                                    <input
                                        type="text"
                                        value={editingProfile.name}
                                        onChange={e => setEditingProfile({ ...editingProfile, name: e.target.value })}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold block mb-2">Custom User-Agent</label>
                                    <input
                                        type="text"
                                        value={editingProfile.user_agent || ''}
                                        onChange={e => setEditingProfile({ ...editingProfile, user_agent: e.target.value })}
                                        placeholder="WebPlayer/2.0 (Optional)"
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                                    />
                                    <p className="text-[9px] text-zinc-600 mt-2 italic px-1">Specific to this profile. Overrides global application user-agent.</p>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold block">Profile Timeshift</label>
                                        <span className="text-xs font-mono font-bold text-blue-400">{editingProfile.timeshift > 0 ? `+${editingProfile.timeshift}` : editingProfile.timeshift}h</span>
                                    </div>
                                    <input
                                        type="range" min="-12" max="12" step="1"
                                        value={editingProfile.timeshift || 0}
                                        onChange={e => setEditingProfile({ ...editingProfile, timeshift: parseInt(e.target.value) })}
                                        className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setEditingProfile(null)}
                                        disabled={isUpdatingProfile}
                                        className="flex-1 px-5 py-3 rounded-xl text-sm font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isUpdatingProfile}
                                        className="flex-1 px-5 py-3 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        {isUpdatingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* EPG Filtering Modal */}
            <AnimatePresence>
                {showCategoryFilter && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[200] flex items-center justify-center p-4 lg:p-6"
                        onClick={() => setShowCategoryFilter(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-[#0f111a] border border-white/10 p-6 lg:p-8 rounded-[2rem] w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh]"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center">
                                        <Filter className="w-6 h-6 text-teal-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-white">EPG Filtering</h3>
                                        <p className="text-xs text-zinc-500 font-medium">Uncheck categories to hide them</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowCategoryFilter(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                    <X className="w-6 h-6 text-zinc-500 hover:text-white" />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex p-1 bg-black/40 rounded-xl mb-6 flex-shrink-0 border border-white/5">
                                {['live', 'movie', 'series'].map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setFilterTab(type)}
                                        className={clsx(
                                            "flex-1 py-2.5 rounded-lg text-xs font-bold uppercase transition-all tracking-wider",
                                            filterTab === type
                                                ? "bg-white/10 text-white shadow"
                                                : "text-zinc-500 hover:text-zinc-300"
                                        )}
                                    >
                                        {type === 'movie' ? 'Movies' : type === 'series' ? 'TV Shows' : 'Live TV'}
                                    </button>
                                ))}
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 pb-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                                {loadingCategories ? (
                                    <div className="flex items-center justify-center p-12">
                                        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
                                    </div>
                                ) : filterCats[filterTab].length > 0 ? (
                                    filterCats[filterTab].map((cat) => {
                                        const catId = String(cat.category_id || cat.id);
                                        const isHidden = hiddenCategories.includes(catId);
                                        return (
                                            <div 
                                                key={catId}
                                                onClick={() => toggleHideCategory(catId)}
                                                className={clsx(
                                                    "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-colors",
                                                    !isHidden ? "bg-teal-500/10 border-teal-500/20" : "bg-white/5 border-white/5 opacity-50 grayscale"
                                                )}
                                            >
                                                <span className={clsx("font-medium", !isHidden ? "text-teal-100" : "text-zinc-500")}>
                                                    {cat.category_name || cat.name}
                                                </span>
                                                <div className={clsx("w-5 h-5 rounded border flex items-center justify-center transition-colors", !isHidden ? "bg-teal-500 border-teal-400" : "border-zinc-600 bg-transparent")}>
                                                    {!isHidden && <Check className="w-3 h-3 text-black font-black" />}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center text-zinc-500 p-8 text-sm">
                                        No categories found. Sync provider data first.
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
        </>
    );
};

export default Settings;
