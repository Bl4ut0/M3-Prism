import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProfile, createProvider, getProviders, getRuntimeConfig, importM3U, loginWithProfile, testProviderConnection, updateRuntimeConfig } from '../api/api';
import { useAuth } from '../context/auth-context';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Key, ListVideo, Layers, ArrowLeft, ArrowRight, Loader2, Check, X, Plus, Trash2, AlertCircle, Sparkles, Film } from 'lucide-react';

const STEPS = { WELCOME: 'welcome', MODE: 'mode', XTREAM: 'xtream', M3U: 'm3u', MULTI: 'multi', COMPLETE: 'complete' };

const Field = ({ label, value, onChange, placeholder, type = 'text', area = false }) => (
    <div className="space-y-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</label>
        {area ? (
            <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full h-24 resize-none bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 placeholder:text-zinc-700" />
        ) : (
            <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 placeholder:text-zinc-700" />
        )}
    </div>
);

const ModeCard = ({ icon: Icon, title, description, accent, onClick, loading }) => (
    <button onClick={onClick} disabled={loading} className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all text-left disabled:opacity-50">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${accent.bg}`}>
            <Icon className={`w-6 h-6 ${accent.text}`} />
        </div>
        <div className="flex-1">
            <div className="font-bold text-white">{title}</div>
            <div className="text-xs text-zinc-500 mt-1">{description}</div>
        </div>
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> : <ArrowRight className="w-4 h-4 text-zinc-600" />}
    </button>
);

const Onboarding = () => {
    const navigate = useNavigate();
    const { login, establishSession, isLocked } = useAuth();
    const [step, setStep] = useState(STEPS.WELCOME);
    const [providers, setProviders] = useState([]);
    const [selectedProviderId, setSelectedProviderId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [runtimeConfig, setRuntimeConfig] = useState({ tmdbApiKey: '', userAgent: 'WebPlayer/2.0', configPath: '' });
    const [xtream, setXtream] = useState({ name: '', url: '', username: '', password: '' });
    const [testResult, setTestResult] = useState(null);
    const [m3u, setM3u] = useState({ name: '', url: '' });
    const [importResult, setImportResult] = useState(null);
    const [multiProviders, setMultiProviders] = useState([{ name: '', url: '' }]);

    useEffect(() => {
        const load = async () => {
            const [config, existingProviders] = await Promise.all([
                getRuntimeConfig(),
                getProviders()
            ]);

            setRuntimeConfig({
                tmdbApiKey: config.tmdbApiKey || '',
                userAgent: config.userAgent || 'WebPlayer/2.0',
                configPath: config.configPath || '',
            });

            setProviders(existingProviders);
            
            if (isLocked) {
                setStep(STEPS.XTREAM);
                if (existingProviders.length > 0) {
                   setSelectedProviderId(existingProviders[0].id);
                   setXtream(prev => ({ ...prev, url: existingProviders[0].url, name: existingProviders[0].name }));
                }
            }
        };
        load().catch(() => {});
    }, [isLocked]);

    const saveRuntimeConfig = async () => {
        const saved = await updateRuntimeConfig({
            tmdbApiKey: runtimeConfig.tmdbApiKey,
            userAgent: runtimeConfig.userAgent,
        });
        setRuntimeConfig((prev) => ({ ...prev, tmdbApiKey: saved.tmdbApiKey || '', userAgent: saved.userAgent || 'WebPlayer/2.0', configPath: saved.configPath || prev.configPath }));
    };

    const moveTo = async (nextStep) => {
        setError('');
        setLoading(true);
        try {
            await saveRuntimeConfig();
            setStep(nextStep);
        } catch (err) {
            setError(err.message || 'Failed to save application settings');
        } finally {
            setLoading(false);
        }
    };

    const handleXtreamTest = async () => {
        setLoading(true); setError(''); setTestResult(null);
        try {
            await saveRuntimeConfig();
            const result = await testProviderConnection(xtream.url, xtream.username, xtream.password);
            setTestResult(result);
            if (!result.success) setError(result.error || 'Connection failed');
        } catch (err) { setError(err.message); } finally { setLoading(false); }
    };

    const handleXtreamSubmit = async () => {
        setLoading(true); setError('');
        try {
            await saveRuntimeConfig();
            
            let providerId = selectedProviderId;
            let currentProvider = providers.find(p => p.id === providerId);

            if (!isLocked || !providerId) {
                const provider = await createProvider({ name: xtream.name || 'My IPTV', url: xtream.url, type: 'xtream' });
                providerId = provider.id;
                currentProvider = { ...provider, url: xtream.url, name: xtream.name };
            }

            const loginResult = await login(
                currentProvider,
                xtream.username,
                xtream.password,
                xtream.name || currentProvider?.name || 'My IPTV'
            );
            if (!loginResult.success) throw new Error(loginResult.message || 'Login failed');
            setStep(STEPS.COMPLETE);
        } catch (err) { setError(err.message || 'Setup failed'); } finally { setLoading(false); }
    };

    const handleM3UImport = async () => {
        setLoading(true); setError(''); setImportResult(null);
        try {
            await saveRuntimeConfig();
            const result = await importM3U(m3u.url, null, m3u.name || 'M3U Playlist');
            if (!result.success) throw new Error(result.error || 'Import failed');
            setImportResult(result);
            const profile = await createProfile({ name: m3u.name || 'M3U Playlist', type: 'm3u', providerId: result.providerId, m3uUrl: m3u.url });
            if (profile.id) {
                const session = await loginWithProfile(profile.id);
                if (session.success && session.provider && session.user_info) establishSession(session.user_info, session.provider, session.profile);
            }
            setStep(STEPS.COMPLETE);
        } catch (err) { setError(err.message || 'Import failed'); } finally { setLoading(false); }
    };

    const handleMultiSubmit = async () => {
        setLoading(true); setError('');
        try {
            await saveRuntimeConfig();
            const valid = multiProviders.filter((provider) => provider.name.trim() && provider.url.trim());
            if (valid.length === 0) throw new Error('Add at least one provider');
            for (const provider of valid) await createProvider({ name: provider.name.trim(), url: provider.url.trim(), type: 'xtream' });
            setStep(STEPS.COMPLETE);
        } catch (err) { setError(err.message || 'Failed to save providers'); } finally { setLoading(false); }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0f1c] text-white overflow-hidden relative">
            <div className="absolute inset-0"><div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-purple-900/15 rounded-full blur-[150px]" /><div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-900/15 rounded-full blur-[150px]" /></div>
            <div className="w-full max-w-2xl z-10 p-8">
                <AnimatePresence mode="wait">
                    {step === STEPS.WELCOME && <motion.div key="welcome" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center"><div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-purple-500/30"><Tv className="w-12 h-12 text-white" /></div><h1 className="text-4xl font-black tracking-tight mb-3">Welcome to <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">M3 Prism</span></h1><p className="text-zinc-500 text-lg mb-10 max-w-lg mx-auto">{isLocked ? 'Your service is pre-configured and ready to use. Just sign in to begin.' : 'Set the runtime configuration first, then choose how you want to connect.'}</p><button onClick={() => setStep(isLocked ? STEPS.XTREAM : STEPS.MODE)} className="px-10 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-lg rounded-2xl shadow-xl shadow-blue-500/25">{isLocked ? 'Sign In Now' : 'Get Started'}</button></motion.div>}

                    {step === STEPS.MODE && <motion.div key="mode" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl"><button onClick={() => setStep(STEPS.WELCOME)} className="flex items-center gap-2 text-zinc-500 hover:text-white text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back</button><h2 className="text-2xl font-black mb-2">Choose Your Setup</h2><p className="text-zinc-500 text-sm mb-6">The runtime config is saved next to the executable or node package.</p><div className="bg-black/20 border border-white/10 rounded-2xl p-5 mb-8"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><Film className="w-5 h-5 text-emerald-400" /></div><div><div className="font-black text-white text-sm">Application Configuration</div><div className="text-[10px] text-zinc-500 uppercase tracking-widest">Used by desktop and web-hosted mode</div></div></div><div className="space-y-4"><Field label="TMDB API Key" value={runtimeConfig.tmdbApiKey} onChange={(value) => setRuntimeConfig((prev) => ({ ...prev, tmdbApiKey: value }))} placeholder="Optional, required for metadata/artwork" /><Field label="Outbound User-Agent" value={runtimeConfig.userAgent} onChange={(value) => setRuntimeConfig((prev) => ({ ...prev, userAgent: value }))} placeholder="WebPlayer/2.0" /></div><div className="mt-4 text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Config file: {runtimeConfig.configPath || 'webplayer.config.json'}</div></div><div className="space-y-3"><ModeCard icon={Key} title="Xtream Codes" description="Connect with a server URL, username, and password." accent={{ bg: 'bg-blue-500/10', text: 'text-blue-400' }} onClick={() => moveTo(STEPS.XTREAM)} loading={loading} /><ModeCard icon={ListVideo} title="M3U / M3U8 Playlist" description="Import a playlist URL and start streaming immediately." accent={{ bg: 'bg-purple-500/10', text: 'text-purple-400' }} onClick={() => moveTo(STEPS.M3U)} loading={loading} /><ModeCard icon={Layers} title="Multi-Provider" description="Save multiple sources now and choose one later." accent={{ bg: 'bg-pink-500/10', text: 'text-pink-400' }} onClick={() => moveTo(STEPS.MULTI)} loading={loading} /></div>{error && <div className="flex items-center gap-2 p-3 rounded-xl mt-6 text-sm bg-red-500/10 border border-red-500/20 text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>}</motion.div>}

                    {step === STEPS.XTREAM && <motion.div key="xtream" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">{!isLocked && <button onClick={() => { setStep(STEPS.MODE); setError(''); setTestResult(null); }} className="flex items-center gap-2 text-zinc-500 hover:text-white text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back</button>}<h2 className="text-2xl font-black mb-6">{isLocked ? 'Sign In to Your Service' : 'Configure Xtream Codes'}</h2><div className="space-y-4 mb-6">{!isLocked && <Field label="Profile Name" value={xtream.name} onChange={(value) => setXtream((prev) => ({ ...prev, name: value }))} placeholder="e.g. Home IPTV" />}{isLocked ? (
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Select Provider</label>
                            <select 
                                value={selectedProviderId} 
                                onChange={(e) => {
                                    const p = providers.find(x => x.id === e.target.value);
                                    setSelectedProviderId(e.target.value);
                                    setXtream(prev => ({ ...prev, url: p?.url || '', name: p?.name || '' }));
                                }}
                                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50"
                            >
                                {providers.map(p => <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}</option>)}
                            </select>
                        </div>
                    ) : (
                        <Field label="Server URL" value={xtream.url} onChange={(value) => setXtream((prev) => ({ ...prev, url: value }))} placeholder="http://your-server.com:8080" />
                    )}<Field label="Username" value={xtream.username} onChange={(value) => setXtream((prev) => ({ ...prev, username: value }))} placeholder="Enter username" /><Field label="Password" value={xtream.password} onChange={(value) => setXtream((prev) => ({ ...prev, password: value }))} placeholder="Enter password" type="password" /></div>
{testResult && <div className={`flex items-center gap-3 p-3 rounded-xl mb-4 text-sm ${testResult.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{testResult.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}{testResult.success ? 'Connection successful. Ready to connect.' : (testResult.error || 'Connection failed')}</div>}{error && <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm bg-red-500/10 border border-red-500/20 text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>}<div className="flex gap-3"><button onClick={handleXtreamTest} disabled={loading || !xtream.url || !xtream.username || !xtream.password} className="flex-1 px-5 py-3 rounded-xl text-sm font-bold bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">{loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Test'}</button><button onClick={handleXtreamSubmit} disabled={loading || !xtream.url || !xtream.username || !xtream.password} className="flex-[2] px-5 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40">{loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Connect & Save'}</button></div></motion.div>}

                    {step === STEPS.M3U && <motion.div key="m3u" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl"><button onClick={() => { setStep(STEPS.MODE); setError(''); setImportResult(null); }} className="flex items-center gap-2 text-zinc-500 hover:text-white text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back</button><div className="space-y-4 mb-6"><Field label="Profile Name" value={m3u.name} onChange={(value) => setM3u((prev) => ({ ...prev, name: value }))} placeholder="e.g. Sports Pack" /><Field label="Playlist URL" value={m3u.url} onChange={(value) => setM3u((prev) => ({ ...prev, url: value }))} placeholder="http://example.com/get.php?username=xxx&password=xxx&type=m3u_plus&output=ts" area /></div>{importResult && <div className="flex items-center gap-3 p-3 rounded-xl mb-4 text-sm bg-green-500/10 border border-green-500/20 text-green-400"><Check className="w-4 h-4" />Imported {importResult.channelCount} channels in {importResult.categoryCount} categories</div>}{error && <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm bg-red-500/10 border border-red-500/20 text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>}<button onClick={handleM3UImport} disabled={loading || !m3u.url.trim()} className="w-full px-5 py-3.5 rounded-xl text-sm font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40">{loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Import Playlist'}</button></motion.div>}

                    {step === STEPS.MULTI && <motion.div key="multi" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl"><button onClick={() => { setStep(STEPS.MODE); setError(''); }} className="flex items-center gap-2 text-zinc-500 hover:text-white text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back</button><div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto pr-1">{multiProviders.map((provider, idx) => <div key={idx} className="flex gap-2 items-start"><div className="flex-1 space-y-2"><input type="text" value={provider.name} onChange={(e) => setMultiProviders((prev) => prev.map((item, index) => index === idx ? { ...item, name: e.target.value } : item))} placeholder="Provider Name" className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-pink-500/50 placeholder:text-zinc-700" /><input type="text" value={provider.url} onChange={(e) => setMultiProviders((prev) => prev.map((item, index) => index === idx ? { ...item, url: e.target.value } : item))} placeholder="http://server-url.com:8080" className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-pink-500/50 placeholder:text-zinc-700" /></div>{multiProviders.length > 1 && <button onClick={() => setMultiProviders((prev) => prev.filter((_, index) => index !== idx))} className="p-2 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-all mt-2"><Trash2 className="w-4 h-4" /></button>}</div>)}</div><button onClick={() => setMultiProviders((prev) => [...prev, { name: '', url: '' }])} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-white/10 text-zinc-500 hover:text-white hover:border-white/20 text-sm font-medium mb-6"><Plus className="w-4 h-4" /> Add Another Provider</button>{error && <div className="flex items-center gap-2 p-3 rounded-xl mb-4 text-sm bg-red-500/10 border border-red-500/20 text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>}<button onClick={handleMultiSubmit} disabled={loading || multiProviders.every((provider) => !provider.name.trim() || !provider.url.trim())} className="w-full px-5 py-3.5 rounded-xl text-sm font-bold bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40">{loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save & Continue'}</button></motion.div>}

                    {step === STEPS.COMPLETE && <motion.div key="complete" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-center"><div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-green-500/30"><Sparkles className="w-10 h-10 text-white" /></div><h1 className="text-3xl font-black tracking-tight mb-3">You&apos;re All Set</h1><p className="text-zinc-500 text-lg mb-4 max-w-lg mx-auto">The runtime is configured and your IPTV source is ready.</p><p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold mb-10">Config file: {runtimeConfig.configPath || 'webplayer.config.json'}</p><button onClick={() => navigate('/login')} className="px-10 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold text-lg rounded-2xl shadow-xl shadow-green-500/25">Start Watching</button></motion.div>}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default Onboarding;
