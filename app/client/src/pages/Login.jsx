import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import {
    checkServerStatus,
    getProfiles,
    getProviders,
    getSetupStatus,
    loginWithProfile,
} from '../api/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, ChevronDown, Loader2, Clock, Plus, ChevronRight, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';

const Login = () => {
    const { login, isAuthenticated, establishSession } = useAuth();
    const navigate = useNavigate();
    const [providers, setProviders] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [selectedProvider, setSelectedProvider] = useState(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [serverStatus, setServerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('profiles');
    const [profileName, setProfileName] = useState('');
    const [saveProfileMode, setSaveProfileMode] = useState(false);
    const [savedProfileLoginEnabled, setSavedProfileLoginEnabled] = useState(true);

    useEffect(() => {
        if (isAuthenticated) {
            navigate('/');
        }
    }, [isAuthenticated, navigate]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const setupStatus = await getSetupStatus();
            if (!setupStatus.configured) {
                navigate('/onboarding');
                return;
            }
            setSavedProfileLoginEnabled(setupStatus.savedProfileLoginEnabled !== false);

            const [providerList, profileList, status] = await Promise.all([
                getProviders(),
                getProfiles(),
                checkServerStatus(),
            ]);

            setProviders(providerList);
            setProfiles(profileList);
            setServerStatus(status ? 'online' : 'offline');

            if (providerList.length > 0) {
                setSelectedProvider(providerList[0]);
            }

            if (profileList.length === 0 || setupStatus.savedProfileLoginEnabled === false) {
                setView('login');
                setSaveProfileMode(profileList.length === 0);
            }
        } catch (err) {
            console.error('Failed to load data', err);
            setError('Could not connect to backend.');
            setView('login');
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoggingIn(true);

        if (!selectedProvider) {
            setError('Please select a service provider');
            setIsLoggingIn(false);
            return;
        }

        if (saveProfileMode && !profileName.trim()) {
            setError('Enter a profile name to save this account.');
            setIsLoggingIn(false);
            return;
        }

        const result = await login(selectedProvider, username, password, saveProfileMode ? profileName.trim() : undefined);
        if (result.success) {
            navigate('/');
        } else {
            setError(result.message);
        }

        setIsLoggingIn(false);
    };

    const handleProfileLogin = async (profile) => {
        setError('');
        setIsLoggingIn(true);

        try {
            const result = await loginWithProfile(profile.id);
            if (result.success && result.provider && result.user_info) {
                establishSession(result.user_info, result.provider, result.profile);
                navigate('/');
            } else {
                setError(result.error || 'Saved credentials are invalid. Please sign in again.');
                setView('login');
            }
        } catch (err) {
            console.error('Profile login failed:', err);
            setError('Failed to load profile. Please sign in manually.');
            setView('login');
        } finally {
            setIsLoggingIn(false);
        }
    };

    const timeAgo = (dateStr) => {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    if (loading) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0f1c]">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0f1c] text-white overflow-hidden relative">
            <div className="absolute inset-0 z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/20 rounded-full blur-[120px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md z-10 p-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl"
            >
                <AnimatePresence mode="wait">
                    {view === 'profiles' && (
                        <motion.div
                            key="profiles"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                        >
                            <div className="flex flex-col items-center mb-8">
                                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
                                    <Tv className="w-8 h-8 text-white" />
                                </div>
                                <h1 className="text-2xl font-black tracking-tight">Welcome Back</h1>
                                <p className="text-zinc-500 text-sm mt-1">Choose a profile to continue</p>
                            </div>

                            <div className="space-y-3 mb-6">
                                {profiles.map((profile) => (
                                    <button
                                        key={profile.id}
                                        onClick={() => handleProfileLogin(profile)}
                                        disabled={isLoggingIn}
                                        className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all text-left group disabled:opacity-50"
                                    >
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-lg font-black text-blue-400">
                                            {profile.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-white truncate">{profile.name}</div>
                                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5 flex items-center gap-2">
                                                <span>{profile.type === 'xtream' ? 'Xtream Codes' : profile.type === 'm3u' ? 'M3U Playlist' : 'Multi-Provider'}</span>
                                                {profile.username && <span>&middot; {profile.username}</span>}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-white transition-colors" />
                                            {profile.last_used && (
                                                <span className="text-[9px] text-zinc-600 flex items-center gap-1">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {timeAgo(profile.last_used)}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {error && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="text-red-400 text-sm text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20 mb-4"
                                >
                                    {error}
                                </motion.div>
                            )}

                            <button
                                onClick={() => { setView('login'); setProfileName(''); setSaveProfileMode(true); }}
                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-white/10 text-zinc-500 hover:text-white hover:border-white/20 transition-all text-sm font-medium"
                            >
                                <Plus className="w-4 h-4" />
                                Add New Profile
                            </button>

                            <div className="mt-6 text-center">
                                <button
                                    onClick={() => { setView('login'); setProfileName(''); setSaveProfileMode(false); }}
                                    className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                                >
                                    Sign in without saving {'->'}
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {view === 'login' && (
                        <motion.div
                            key="login"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            {savedProfileLoginEnabled && profiles.length > 0 && (
                                <button
                                    onClick={() => { setView('profiles'); setError(''); }}
                                    className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors text-sm mb-6"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    Back to profiles
                                </button>
                            )}

                            <div className="flex flex-col items-center mb-8">
                                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
                                    <Tv className="w-8 h-8 text-white" />
                                </div>
                                <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                                    {saveProfileMode ? 'Add Profile' : 'IPTV Hub'}
                                </h1>
                                <p className="text-zinc-500 mt-2 text-sm flex items-center gap-2">
                                    Server:
                                    <span className={clsx('flex items-center gap-1', serverStatus === 'online' ? 'text-green-400' : 'text-red-400')}>
                                        <span className={clsx('w-2 h-2 rounded-full', serverStatus === 'online' ? 'bg-green-400' : 'bg-red-400')} />
                                        {serverStatus || 'Checking...'}
                                    </span>
                                </p>
                            </div>

                            <form onSubmit={handleLogin} className="space-y-5">
                                {saveProfileMode && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Profile Name</label>
                                        <input
                                            type="text"
                                            value={profileName}
                                            onChange={(e) => setProfileName(e.target.value)}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-700"
                                            placeholder="e.g. Dad's Account, Sports Only..."
                                        />
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Service Provider</label>
                                    <div className="relative">
                                        <select
                                            value={selectedProvider?.id || ''}
                                            onChange={(e) => setSelectedProvider(providers.find((provider) => provider.id === e.target.value))}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
                                        >
                                            {providers.map((provider) => (
                                                <option key={provider.id} value={provider.id} className="bg-zinc-900">
                                                    {provider.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Username</label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-700"
                                            placeholder="Enter username"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Password</label>
                                        <input
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-700"
                                            placeholder="Enter password"
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="text-red-400 text-sm text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20"
                                    >
                                        {error}
                                    </motion.div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isLoggingIn}
                                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isLoggingIn ? <Loader2 className="animate-spin w-5 h-5" /> : (saveProfileMode ? 'Save Profile & Connect' : 'Start Watching')}
                                </button>
                            </form>

                            <div className="mt-8 text-center text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
                                v2.0.0 &middot; Encrypted Sessions
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};

export default Login;
