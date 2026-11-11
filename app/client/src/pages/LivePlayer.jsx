import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import VideoPlayer from '../components/VideoPlayer';
import { fetchCachedCategories, fetchCachedChannels, fetchXtreamData, syncAllData, getCachedEPG, getLiveStreamUrl, toggleFavorite, checkFavorite, recordRecentChannel, getRecentChannels } from '../api/api';
import {
    Search,
    Play,
    Maximize2,
    Minimize2,
    Loader2,
    LayoutTemplate,
    Info,
    X,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Filter,
    Hash,
    Heart,
    Clock
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import FallbackImage from '../components/FallbackImage';

const LivePlayer = () => {
    const {
        user,
        currentProvider,
        hiddenChannels,
        hiddenCategories,
        toggleHideChannel,
        toggleHideCategory
    } = useAuth();
    const location = useLocation();

    // Data State
    const [categories, setCategories] = useState([]);
    const [channels, setChannels] = useState([]);
    const [epgData, setEpgData] = useState({});

    // Selection State
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [showHidden, setShowHidden] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(24);

    // Layout State
    const [showSidebar, setShowSidebar] = useState(true);
    const [showChannelList, setShowChannelList] = useState(true);
    const [showInfo, setShowInfo] = useState(false);
    const [playbackUrl, setPlaybackUrl] = useState('');

    // Favorites & Recent
    const [isFavorited, setIsFavorited] = useState(false);
    const [recentChannels, setRecentChannels] = useState([]);
    const autoSyncRef = useRef(false);

    // Helper to safely decode base64 or return original if not b64
    const decodeB64 = (str) => {
        if (!str) return '';
        if (str.includes(' ')) return str;
        try {
            if (!/^[A-Za-z0-9+/=]+$/.test(str)) return str;
            const decoded = atob(str);
            return decodeURIComponent(escape(decoded));
        } catch {
            return str;
        }
    };

    // Helper to parse EPG date with timeshift
    const parseEPGDate = (dateStr) => {
        if (!dateStr) return null;
        const date = new Date(decodeB64(dateStr));
        if (isNaN(date.getTime())) return null;

        // Apply timeshift if defined (even if 0)
        const shift = currentProvider?.timeshift ?? 0;
        if (shift !== 0) {
            date.setHours(date.getHours() + shift);
        }
        return date;
    };

    // Find the program that is "Live Now" considering the offset
    const getCurrentProgram = (streamId) => {
        const listings = epgData[streamId];
        if (!listings || !Array.isArray(listings)) return null;

        const now = new Date();
        return listings.find(prog => {
            const start = parseEPGDate(prog.start);
            const stop = parseEPGDate(prog.stop);
            return start && stop && now >= start && now <= stop;
        }) || listings[0]; // Fallback to first if nothing matches
    };

    // Selection optimization
    const currentCategoryId = selectedCategory?.id;
    const currentChannelId = selectedChannel?.stream_id;
    const activeProgram = selectedChannel ? getCurrentProgram(selectedChannel.stream_id) : null;

    // Handle channel selection from TV Guide
    useEffect(() => {
        if (location.state?.channel) {
            setSelectedChannel(location.state.channel);
            setShowChannelList(false);
            setShowSidebar(false);
        }
    }, [location.state]);

    // Load recent channels on mount
    useEffect(() => {
        if (currentProvider?.id) {
            getRecentChannels(currentProvider.id).then(setRecentChannels).catch(() => {});
        }
    }, [currentProvider]);

    const [isAutoSyncing, setIsAutoSyncing] = useState(false);

    const fetchData = useCallback(async () => {
        if (!user || !currentProvider) return;
        setIsLoading(true);
        try {
            const [catData, channelsData] = await Promise.all([
                fetchCachedCategories(currentProvider.id),
                fetchCachedChannels(currentProvider.id)
            ]);

            // If DB is empty for this provider, trigger an auto-sync
            if (currentProvider.type !== 'm3u' && (!channelsData || channelsData.length === 0) && !autoSyncRef.current) {
                console.log("No cached data found for this provider. Triggering auto-sync...");
                autoSyncRef.current = true;
                setIsAutoSyncing(true);
                await syncAllData(currentProvider.id, user);
                // Re-fetch after sync
                const [newCats, newChans] = await Promise.all([
                    fetchCachedCategories(currentProvider.id),
                    fetchCachedChannels(currentProvider.id)
                ]);
                setCategories(newCats || []);
                setChannels(newChans || []);
            } else {
                setCategories(catData || []);
                setChannels(channelsData || []);
            }
        } catch (error) {
            console.error("Failed to load playlist from local DB", error);
        } finally {
            autoSyncRef.current = false;
            setIsAutoSyncing(false);
            setIsLoading(false);
        }
    }, [user, currentProvider]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const fetchEPG = useCallback(async (streamId) => {
        if (!user || !currentProvider) return;
        try {
            // 1. Try server-cached EPG first
            const cached = await getCachedEPG(streamId, currentProvider?.id);
            if (cached && cached.epg_listings && cached.epg_listings.length > 0) {
                // Map DB column names to the format the UI expects
                const mapped = cached.epg_listings.map(row => ({
                    title: row.title,
                    description: row.description,
                    start: row.start_time,
                    stop: row.stop_time,
                }));
                setEpgData(prev => ({ ...prev, [streamId]: mapped }));
                return;
            }

            if (currentProvider.type === 'm3u') {
                setEpgData(prev => ({ ...prev, [streamId]: [] }));
                return;
            }

            // 2. Fallback to live provider fetch
            const data = await fetchXtreamData(currentProvider.url, {
                username: user.username,
                password: user.password,
                action: 'get_short_epg',
                stream_id: streamId
            });
            const listings = (data && Array.isArray(data.epg_listings)) ? data.epg_listings : [];
            setEpgData(prev => ({ ...prev, [streamId]: listings }));
        } catch (err) {
            console.error("EPG Fetch failed", err);
            setEpgData(prev => ({ ...prev, [streamId]: [] })); // Mark as checked
        }
    }, [user, currentProvider]);

    useEffect(() => {
        if (selectedChannel) {
            fetchEPG(selectedChannel.stream_id);
            setShowInfo(false);

            // Record recent channel
            recordRecentChannel(selectedChannel.stream_id, selectedChannel.name, selectedChannel.stream_icon, currentProvider?.id);

            // Check if favorited
            checkFavorite(String(selectedChannel.stream_id), 'channel').then(r => setIsFavorited(r.favorited)).catch(() => {});
        }
    }, [selectedChannel, currentProvider?.id, fetchEPG]);

    useEffect(() => {
        const resolvePlaybackUrl = async () => {
            if (!selectedChannel || !currentProvider || !user) {
                setPlaybackUrl('');
                return;
            }

            if (currentProvider.type === 'm3u') {
                try {
                    const resolved = await getLiveStreamUrl(selectedChannel.stream_id, currentProvider.id);
                    setPlaybackUrl(resolved || '');
                } catch (error) {
                    console.error('Failed to resolve M3U stream url', error);
                    setPlaybackUrl('');
                }
                return;
            }

            const baseUrl = currentProvider.url.endsWith('/') ? currentProvider.url.slice(0, -1) : currentProvider.url;
            setPlaybackUrl(`${baseUrl}/live/${user.username}/${user.password}/${selectedChannel.stream_id}.ts`);
        };

        resolvePlaybackUrl();
    }, [selectedChannel, currentProvider, user]);

    // Enhanced Search: Present both category and channel matches
    const searchResults = useMemo(() => {
        if (!searchQuery) return null;
        const lower = searchQuery.toLowerCase();

        const catMatches = categories.filter(c => c.name.toLowerCase().includes(lower));
        const chanMatches = channels.filter(c => c.name.toLowerCase().includes(lower));

        return { categories: catMatches, channels: chanMatches };
    }, [searchQuery, categories, channels]);

    const visibleCategories = useMemo(() => {
        let list = categories;
        if (searchQuery) {
            list = list.filter(cat => {
                const name = (cat.name || cat.category_name || '').toLowerCase();
                return name.includes(searchQuery.toLowerCase());
            });
        }
        if (!showHidden) {
            list = list.filter(cat => !hiddenCategories.includes(String(cat.category_id || cat.id)));
        }
        return list;
    }, [categories, hiddenCategories, showHidden, searchQuery]);

    const filteredChannels = useMemo(() => {
        let list = channels;
        if (selectedCategory) {
            list = list.filter(ch => ch.category_id === selectedCategory.id);
        }
        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            list = list.filter(ch => ch.name.toLowerCase().includes(lower));
        }
        if (!showHidden) {
            list = list.filter(ch => !hiddenChannels.includes(String(ch.stream_id)));
            if (!selectedCategory) {
                list = list.filter(ch => !hiddenCategories.includes(String(ch.category_id)));
            }
        }
        return list;
    }, [channels, selectedCategory, searchQuery, hiddenChannels, hiddenCategories, showHidden]);

    // Pagination Calculations
    const totalPages = Math.ceil(filteredChannels.length / itemsPerPage);
    const paginatedChannels = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredChannels.slice(start, start + itemsPerPage);
    }, [filteredChannels, currentPage, itemsPerPage]);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedCategory, searchQuery, itemsPerPage]);

    return (
        <div className="flex h-full bg-[#05080f] overflow-hidden">

            <AnimatePresence>
                {showSidebar && (
                    <motion.div
                        initial={{ x: -250, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -250, opacity: 0 }}
                        className="w-64 flex flex-col border-r border-white/5 bg-black/40 backdrop-blur-md"
                    >
                        <div className="p-4 border-b border-white/5 flex justify-between items-center">
                            <span className="font-bold text-gray-400 uppercase text-xs tracking-wider">
                                {searchQuery ? 'Matching Types' : `Categories (${visibleCategories.length})`}
                            </span>
                            <button
                                onClick={() => setShowHidden(!showHidden)}
                                className={clsx("text-[10px] px-2 py-1 rounded border transition-colors", showHidden ? "bg-blue-600 border-blue-500 text-white" : "border-white/10 text-gray-500 hover:text-white")}
                            >
                                {showHidden ? 'Hide Hidden' : 'Show Hidden'}
                            </button>
                        </div>

                        {isAutoSyncing && (
                            <div className="mx-2 mt-2 p-4 bg-blue-600/10 border border-blue-500/20 rounded-xl">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                                    <div>
                                        <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Auto-Cashing</p>
                                        <p className="text-[10px] text-zinc-500 font-medium">Syncing playlist data...</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className={clsx("w-full text-left px-4 py-3 rounded-lg text-sm transition-colors", !selectedCategory ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5")}
                            >
                                All Channels
                            </button>

                            {/* Show Category Matches first if searching */}
                            {searchQuery && searchResults?.categories.length > 0 && (
                                <div className="px-3 pt-3 pb-1">
                                    <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">Categories</span>
                                </div>
                            )}

                            {visibleCategories.map(cat => (
                                <div
                                    key={cat.id}
                                    className={clsx(
                                        "group flex items-center gap-1",
                                        !showHidden && hiddenCategories.includes(cat.id) && "hidden-pref"
                                    )}
                                >
                                    <button
                                        onClick={() => setSelectedCategory(cat)}
                                        className={clsx(
                                            "flex-1 text-left px-4 py-3 rounded-lg text-sm transition-colors truncate",
                                            currentCategoryId === cat.id ? "bg-blue-600/20 text-blue-400 border border-blue-500/20" : "text-gray-400 hover:bg-white/5"
                                        )}
                                    >
                                        {cat.name || cat.category_name}
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleHideCategory(cat.id); }}
                                        className={clsx("p-2 rounded hover:bg-white/10 transition-all", hiddenCategories.includes(cat.id) ? "text-red-500 opacity-100" : "text-gray-600 opacity-0 group-hover:opacity-100")}
                                        title={hiddenCategories.includes(cat.id) ? "Show Category" : "Hide Category"}
                                    >
                                        {hiddenCategories.includes(cat.id) ? <Minimize2 className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showChannelList && (
                    <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 320, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="flex flex-col border-r border-white/5 bg-black/20 backdrop-blur-sm"
                    >
                        <div className="p-4 border-b border-white/5">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search channels..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                                />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10">
                            {isLoading ? (
                                <div className="flex items-center justify-center h-40">
                                    <Loader2 className="animate-spin text-blue-500" />
                                </div>
                            ) : (
                                <>
                                    {paginatedChannels.map(channel => (
                                        <div
                                            key={channel.stream_id}
                                            className={clsx(
                                                "w-full flex items-center p-2 rounded-lg group transition-all relative px-3",
                                                currentChannelId === channel.stream_id ? "bg-white/10 shadow-lg" : "hover:bg-white/5",
                                                !showHidden && hiddenChannels.includes(channel.stream_id) && "hidden-pref"
                                            )}
                                        >
                                            <button
                                                onClick={() => setSelectedChannel(channel)}
                                                className="flex-1 flex items-center text-left overflow-hidden py-1"
                                            >
                                                <div className="w-10 h-10 rounded bg-black/50 flex items-center justify-center overflow-hidden border border-white/5 mr-3 shrink-0">
                                                    <FallbackImage
                                                        src={channel.stream_icon}
                                                        alt={channel.num}
                                                        className="w-full h-full object-cover"
                                                        type="icon"
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className={clsx("text-sm font-medium truncate", currentChannelId === channel.stream_id ? "text-white" : "text-gray-300 group-hover:text-white")}>
                                                        {channel.name}
                                                    </p>
                                                    {epgData[channel.stream_id]?.[0] && (
                                                        <p className="text-[10px] text-gray-500 truncate mt-0.5">
                                                            {decodeB64(epgData[channel.stream_id][0].title)}
                                                        </p>
                                                    )}
                                                </div>
                                            </button>

                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleHideChannel(channel.stream_id); }}
                                                    className={clsx("p-1.5 hover:bg-white/10 rounded", hiddenChannels.includes(channel.stream_id) ? "text-red-500 opacity-100" : "text-gray-400 hover:text-white opacity-0 group-hover:opacity-100")}
                                                    title={hiddenChannels.includes(channel.stream_id) ? "Show Channel" : "Hide Channel"}
                                                >
                                                    {hiddenChannels.includes(channel.stream_id) ? <Minimize2 className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                            {currentChannelId === channel.stream_id && <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />}
                                        </div>
                                    ))}
                                    {filteredChannels.length === 0 && (
                                        <div className="p-8 text-center text-gray-500 text-sm">No channels found</div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Sidebar Pagination Footer */}
                        {!isLoading && filteredChannels.length > 0 && (
                            <div className="p-3 border-t border-white/5 bg-black/40 flex flex-col gap-2">
                                <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-gray-500 font-bold uppercase tracking-widest">{filteredChannels.length} Channels</span>
                                    <div className="flex items-center gap-1 bg-white/5 rounded px-1.5 py-0.5 border border-white/5">
                                        <select
                                            value={itemsPerPage}
                                            onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                                            className="bg-transparent text-white focus:outline-none cursor-pointer font-bold appearance-none"
                                        >
                                            <option value="24" className="bg-zinc-900">25</option>
                                            <option value="50" className="bg-zinc-900">50</option>
                                            <option value="100" className="bg-zinc-900">100</option>
                                        </select>
                                        <ChevronDown className="w-2.5 h-2.5 text-gray-400" />
                                    </div>
                                </div>
                                <div className="flex items-center justify-center gap-3">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="text-gray-500 hover:text-white disabled:opacity-20"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                    <span className="text-[10px] font-black text-blue-500">{currentPage} <span className="text-zinc-700 mx-1">/</span> {totalPages}</span>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="text-gray-500 hover:text-white disabled:opacity-20"
                                    >
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-1 flex flex-col relative bg-black">
                <div className="absolute top-0 left-0 right-0 p-4 flex justify-between z-20 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                    <div className="pointer-events-auto">
                        {selectedChannel && (
                            <div className="flex flex-col">
                                <h1 className="text-xl font-bold text-white drop-shadow-md">{selectedChannel.name}</h1>
                                {activeProgram && (
                                    <p className="text-sm text-blue-400 font-bold tracking-tight">
                                        {decodeB64(activeProgram.title)}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2 pointer-events-auto">
                        {selectedChannel && (
                            <button
                                onClick={() => setShowInfo(!showInfo)}
                                className={clsx(
                                    "p-2 rounded-lg text-white backdrop-blur-md transition-all",
                                    showInfo ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]" : "bg-white/10 hover:bg-white/20"
                                )}
                                title="Program Info"
                            >
                                <Info className="w-5 h-5" />
                            </button>
                        )}
                        {selectedChannel && (
                            <button
                                onClick={async () => {
                                    const res = await toggleFavorite(String(selectedChannel.stream_id), 'channel', selectedChannel.name, selectedChannel.stream_icon, currentProvider?.id);
                                    setIsFavorited(res.favorited);
                                }}
                                className={clsx(
                                    "p-2 rounded-lg text-white backdrop-blur-md transition-all",
                                    isFavorited ? "bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.4)]" : "bg-white/10 hover:bg-white/20"
                                )}
                                title={isFavorited ? 'Remove Favorite' : 'Add to Favorites'}
                            >
                                <Heart className={clsx("w-5 h-5", isFavorited && "fill-current")} />
                            </button>
                        )}
                        <button
                            onClick={() => { setShowSidebar(!showSidebar); setShowChannelList(!showChannelList); }}
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white backdrop-blur-md transition-colors"
                            title="Toggle Full Player"
                        >
                            <LayoutTemplate className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {selectedChannel ? (
                    <div className="relative w-full h-full flex items-center justify-center group overflow-hidden">
                        <VideoPlayer
                            src={playbackUrl}
                            className="w-full h-full object-contain"
                        />
                        <AnimatePresence>
                            {showInfo && activeProgram && (
                                <motion.div
                                    initial={{ opacity: 0, x: 50 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 50 }}
                                    className="absolute top-20 right-8 z-30 w-80 bg-zinc-950/90 backdrop-blur-2xl p-8 rounded-[2.5rem] border border-white/10 shadow-3xl"
                                >
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-lg">Live Now</span>
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">CH {selectedChannel.num}</span>
                                        </div>
                                        <button onClick={() => setShowInfo(false)} className="text-zinc-500 hover:text-white transition-colors">
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <h2 className="text-xl font-black text-white mb-4 leading-tight tracking-tight">
                                        {decodeB64(activeProgram.title)}
                                    </h2>
                                    <div className="h-px w-10 bg-blue-500 mb-6" />
                                    <p className="text-sm text-zinc-400 leading-relaxed max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-white/5 pr-3 mb-8">
                                        {activeProgram.description
                                            ? decodeB64(activeProgram.description)
                                            : "No detailed description provided for this program."}
                                    </p>
                                    <button
                                        onClick={() => setShowInfo(false)}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98] shadow-xl"
                                    >
                                        Done
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 bg-[#020408]">
                        {recentChannels.length > 0 ? (
                            <div className="w-full max-w-2xl px-8">
                                <div className="flex items-center gap-3 mb-6">
                                    <Clock className="w-5 h-5 text-blue-500" />
                                    <h2 className="text-lg font-bold text-zinc-300">Recent Channels</h2>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {recentChannels.slice(0, 8).map(ch => (
                                        <button
                                            key={ch.stream_id}
                                            onClick={() => {
                                                const found = channels.find(c => c.stream_id === ch.stream_id);
                                                if (found) setSelectedChannel(found);
                                                else setSelectedChannel({ stream_id: ch.stream_id, name: ch.name, stream_icon: ch.stream_icon, num: 0 });
                                            }}
                                            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-blue-500/20 transition-all group"
                                        >
                                            <div className="w-12 h-12 rounded-lg bg-black/50 flex items-center justify-center overflow-hidden border border-white/5">
                                                <FallbackImage src={ch.stream_icon} alt={ch.name} className="w-full h-full object-cover" type="icon" />
                                            </div>
                                            <span className="text-xs text-zinc-400 group-hover:text-white font-medium truncate w-full text-center transition-colors">{ch.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="w-24 h-24 rounded-full bg-white/[0.02] flex items-center justify-center mb-8 border border-white/5">
                                    <Play className="w-10 h-10 opacity-20" />
                                </div>
                                <h2 className="text-xl font-bold text-zinc-400">Ready to Play</h2>
                                <p className="text-sm mt-2 opacity-50">Select a channel from the left menu to start streaming</p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LivePlayer;
