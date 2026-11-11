import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/auth-context';
import { fetchCachedCategories, fetchCachedChannels, fetchXtreamData, syncAllData, getCachedEPGBatch } from '../api/api';
import {
    Search,
    Calendar,
    Clock,
    ChevronLeft,
    ChevronRight,
    Play,
    Info,
    Loader2,
    Tv,
    Database,
    RefreshCw,
    X,
    ShieldOff
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import FallbackImage from '../components/FallbackImage';
import { useNavigate } from 'react-router-dom';

const TVGuide = () => {
    const { user, currentProvider, activeProfile, hiddenChannels, hiddenCategories } = useAuth();
    const navigate = useNavigate();

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
    const parseEPGDate = (dateStr, timestamp) => {
        let date = null;

        // 1. Try absolute Unix timestamp first
        if (timestamp) {
            const parsedTs = parseInt(timestamp);
            // Must be a valid timestamp (greater than 0 to avoid 1970 origin placement)
            if (!isNaN(parsedTs) && parsedTs > 0) {
                date = new Date(parsedTs * 1000);
            }
        } 

        // 2. Fallback to String Parsing
        if ((!date || isNaN(date.getTime())) && dateStr) {
            const rawStr = decodeB64(dateStr);
            
            // Try raw string (often works natively in Chrome for most formats)
            date = new Date(rawStr);

            // If it failed (Safari often hates missing 'T'), selectively insert 'T' if it's standard YYYY-MM-DD
            if (isNaN(date.getTime()) && rawStr.length >= 19 && rawStr.charAt(10) === ' ') {
                const fixedStr = rawStr.substring(0, 10) + 'T' + rawStr.substring(11);
                date = new Date(fixedStr);
            }
        }

        if (!date || isNaN(date.getTime())) return null;

        const providerShift = currentProvider?.timeshift ?? 0;
        const profileShift = activeProfile?.timeshift ?? 0;
        const totalShift = providerShift + profileShift;
        
        if (totalShift !== 0) {
            date.setHours(date.getHours() + totalShift);
        }
        return date;
    };

    // Core Data
    const [categories, setCategories] = useState([]);
    const [channels, setChannels] = useState([]);
    const [epgData, setEpgData] = useState({}); // { [streamId]: listings }
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [, setIsEpgLoading] = useState(false);
    const [fetchingEpgIds, setFetchingEpgIds] = useState(new Set());
    const [showHidden, setShowHidden] = useState(false);

    // Time Control
    const [viewDate] = useState(new Date());
    const [timeOffset, setTimeOffset] = useState(0); // Minutes from current window start

    // UI State
    const [selectedProgram, setSelectedProgram] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const gridRef = useRef(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(25);

    // Grid Configuration
    const HOUR_WIDTH = 400; // pixels per hour
    const MIN_WIDTH = HOUR_WIDTH / 60;

    const [isAutoSyncing, setIsAutoSyncing] = useState(false);
    const autoSyncRef = useRef(false);

    // 1. Fetch Categories & Channels
    useEffect(() => {
        const loadInitialData = async () => {
            if (!user || !currentProvider) return;
            setIsLoading(true);
            try {
                const cats = await fetchCachedCategories(currentProvider.id);
                const streams = await fetchCachedChannels(currentProvider.id);

                if ((!streams || streams.length === 0) && !autoSyncRef.current) {
                    autoSyncRef.current = true;
                    setIsAutoSyncing(true);
                    await syncAllData(currentProvider.id, user);
                    const newCats = await fetchCachedCategories(currentProvider.id);
                    const newStreams = await fetchCachedChannels(currentProvider.id);
                    setCategories(newCats || []);
                    setChannels(newStreams || []);
                } else {
                    setCategories(cats || []);
                    setChannels(streams || []);
                }

                // Select first visible category (using updated data if sync happened)
                const currentCats = cats?.length ? cats : [];
                const firstVisible = currentCats.find(c => !hiddenCategories.includes(c.id));
                if (firstVisible) {
                    setSelectedCategory(firstVisible);
                } else if (currentCats.length > 0) {
                    setSelectedCategory(currentCats[0]);
                }
            } catch (err) {
                console.error("Guide Load Error:", err);
            } finally {
                autoSyncRef.current = false;
                setIsAutoSyncing(false);
                setIsLoading(false);
            }
        };
        loadInitialData();
    }, [user, currentProvider, hiddenCategories]);

    // Filtered Categories for dropdown
    const filteredCategories = useMemo(() => {
        if (showHidden) return categories;
        return categories.filter(c => !hiddenCategories.includes(String(c.category_id || c.id)));
    }, [categories, hiddenCategories, showHidden]);

    // 2. Fetch EPG for filtered channels
    const visibleChannels = useMemo(() => {
        let list = channels;
        if (!showHidden) {
            list = list.filter(c => !hiddenChannels.includes(String(c.stream_id)));
            if (!selectedCategory) {
                list = list.filter(c => !hiddenCategories.includes(String(c.category_id)));
            }
        }
        if (selectedCategory) {
            list = list.filter(c => c.category_id === selectedCategory.id);
        }
        if (searchQuery) {
            list = list.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        return list;
    }, [channels, selectedCategory, searchQuery, hiddenChannels, hiddenCategories, showHidden]);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedCategory, searchQuery, itemsPerPage]);

    const totalPages = Math.ceil(visibleChannels.length / itemsPerPage);
    const paginatedChannels = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return visibleChannels.slice(start, start + itemsPerPage);
    }, [visibleChannels, currentPage, itemsPerPage]);

    useEffect(() => {
        const loadBatchEPG = async () => {
            if (paginatedChannels.length === 0 || !user) return;

            // Filter to only channels we haven't checked yet
            const channelsToFetch = paginatedChannels.filter(c => epgData[c.stream_id] === undefined && !fetchingEpgIds.has(c.stream_id));
            if (channelsToFetch.length === 0) return;

            setIsEpgLoading(true);
            setFetchingEpgIds(prev => {
                const next = new Set(prev);
                channelsToFetch.forEach(c => next.add(c.stream_id));
                return next;
            });

            try {
                // 1. Try batch fetch from server-cached EPG database
                const streamIds = channelsToFetch.map(c => c.stream_id);
                const cachedBatch = await getCachedEPGBatch(streamIds, currentProvider?.id);

                const stillMissing = [];

                for (const ch of channelsToFetch) {
                    const cached = cachedBatch[ch.stream_id];
                    if (cached && cached.length > 0) {
                        // Map DB column names to the format the UI expects
                        const mapped = cached.map(row => ({
                            title: row.title,
                            description: row.description,
                            start: row.start_time,
                            stop: row.stop_time,
                        }));
                        setEpgData(prev => ({ ...prev, [ch.stream_id]: mapped }));
                        setFetchingEpgIds(prev => {
                            const next = new Set(prev);
                            next.delete(ch.stream_id);
                            return next;
                        });
                    } else {
                        stillMissing.push(ch);
                    }
                }

                // 2. Fallback: fetch remaining channels live (sequentially to avoid rate-limiting)
                for (const ch of stillMissing) {
                    try {
                        const data = await fetchXtreamData(currentProvider.url, {
                            username: user.username,
                            password: user.password,
                            action: 'get_short_epg',
                            stream_id: ch.stream_id
                        });

                        const listings = (data && Array.isArray(data.epg_listings)) ? data.epg_listings : [];
                        setEpgData(prev => ({ ...prev, [ch.stream_id]: listings }));
                    } catch {
                        setEpgData(prev => ({ ...prev, [ch.stream_id]: [] }));
                    } finally {
                        setFetchingEpgIds(prev => {
                            const next = new Set(prev);
                            next.delete(ch.stream_id);
                            return next;
                        });
                    }
                }
            } catch (e) {
                console.error('EPG batch load error:', e);
                // Mark all as checked with empty data on total failure
                for (const ch of channelsToFetch) {
                    setEpgData(prev => ({ ...prev, [ch.stream_id]: [] }));
                    setFetchingEpgIds(prev => {
                        const next = new Set(prev);
                        next.delete(ch.stream_id);
                        return next;
                    });
                }
            }

            setIsEpgLoading(false);
        };
        loadBatchEPG();
    }, [paginatedChannels, user, currentProvider, epgData, fetchingEpgIds]);

    const startTime = useMemo(() => {
        const start = new Date(viewDate);
        start.setMinutes(start.getMinutes() + timeOffset);
        start.setSeconds(0, 0);
        return start;
    }, [viewDate, timeOffset]);

    const timeBlocks = useMemo(() => {
        const blocks = [];
        for (let i = 0; i < 7; i++) {
            const t = new Date(startTime);
            t.setMinutes(t.getMinutes() + i * 30);
            blocks.push(t);
        }
        return blocks;
    }, [startTime]);

    const formatTime = (date) => {
        if (!date) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getProgramWidth = (prog, pIdx, programs) => {
        const start = parseEPGDate(prog.start, prog.start_timestamp);
        let end = parseEPGDate(prog.end || prog.stop, prog.stop_timestamp || prog.end_timestamp);
        
        // Fallback: use NEXT program's start time if end time is missing
        if (!end && programs && pIdx < programs.length - 1) {
            const nextProg = programs[pIdx + 1];
            end = parseEPGDate(nextProg.start, nextProg.start_timestamp);
        }
        // Fallback: assume 1 hour duration if it's the last item and has no end time
        if (!end && start) {
            end = new Date(start.getTime() + 60 * 60 * 1000);
        }

        if (!start || !end) return 50;
        const diffMin = (end - start) / (1000 * 60);
        return Math.max(diffMin * MIN_WIDTH, 50);
    };

    const getProgramOffset = (prog) => {
        const start = parseEPGDate(prog.start, prog.start_timestamp);
        if (!start) return 0;
        const diffMin = (start - startTime) / (1000 * 60);
        return diffMin * MIN_WIDTH;
    };

    const [nowPos, setNowPos] = useState(0);
    useEffect(() => {
        const updateNow = () => {
            const now = new Date();
            const diffMin = (now - startTime) / (1000 * 60);
            setNowPos(diffMin * MIN_WIDTH);
        };
        updateNow();
        const interval = setInterval(updateNow, 60000);
        return () => clearInterval(interval);
    }, [startTime, MIN_WIDTH]);

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-[#05080f]">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-400 font-medium">Building TV Grid...</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#05080f] text-white overflow-hidden">
            <header className="p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-6 bg-black/40 backdrop-blur-xl shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-blue-600/10 rounded-xl">
                        <Calendar className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight flex items-center gap-3">
                            TV Guide
                            {isAutoSyncing && (
                                <span className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
                                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                                    <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest animate-pulse">Auto-Syncing</span>
                                </span>
                            )}
                        </h1>
                        <p className="text-xs text-gray-500 font-mono uppercase">{startTime.toDateString()}</p>
                    </div>
                </div>

                <div className="flex flex-1 max-w-xl gap-4">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            placeholder="Find a channel..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-10 py-2.5 text-sm focus:outline-none focus:border-blue-500/50 transition-all"
                        />
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    </div>

                    <select
                        value={selectedCategory?.id || ''}
                        onChange={(e) => setSelectedCategory(filteredCategories.find(c => c.id === e.target.value))}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500/50"
                    >
                        {filteredCategories.map(cat => (
                            <option key={cat.id} value={cat.id} className="bg-zinc-900">{cat.name}</option>
                        ))}
                    </select>

                    <button
                        onClick={() => setShowHidden(!showHidden)}
                        className={clsx(
                            "px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border",
                            showHidden ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-gray-400"
                        )}
                    >
                        {showHidden ? 'Show Visible' : 'Show Hidden'}
                    </button>
                </div>

                <div className="flex items-center gap-2 bg-white/5 rounded-xl p-1 border border-white/5">
                    <button onClick={() => setTimeOffset(prev => prev - 60)} className="p-2 hover:bg-white/10 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
                    <button onClick={() => setTimeOffset(0)} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-white/10 rounded-lg">Now</button>
                    <button onClick={() => setTimeOffset(prev => prev + 60)} className="p-2 hover:bg-white/10 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
                </div>
            </header>

            <div className="flex-1 flex flex-col relative overflow-hidden">
                <div className="flex bg-black/60 border-b border-white/5 z-30 sticky top-0">
                    <div className="w-64 border-r border-white/10 shrink-0 flex items-center px-6 text-[10px] font-black uppercase text-gray-500 tracking-[0.2em]">Channel List</div>
                    <div className="flex-1 overflow-hidden relative">
                        <div className="flex" style={{ transform: `translateX(${-gridRef.current?.scrollLeft || 0}px)` }}>
                            {timeBlocks.map((time, idx) => (
                                <div key={idx} className="shrink-0 border-r border-white/5 flex items-center px-4" style={{ width: HOUR_WIDTH / 2 }}>
                                    <Clock className="w-3 h-3 text-blue-500 mr-2" />
                                    <span className="text-xs font-bold text-gray-400">{formatTime(time)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div ref={gridRef} className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-white/10">
                    <div className="relative" style={{ minWidth: HOUR_WIDTH * 3 + 256 }}>
                        {nowPos > 0 && nowPos < HOUR_WIDTH * 3 && (
                            <div className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none" style={{ left: nowPos + 256 }}>
                                <div className="absolute top-0 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_red]" />
                            </div>
                        )}

                        {channels.length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-20 text-center">
                                <Database className="w-10 h-10 text-gray-600 mb-6" />
                                <h3 className="text-xl font-bold mb-2">No Channel Data</h3>
                                <button onClick={() => syncAllData(currentProvider.id, user)} className="flex items-center px-6 py-3 bg-blue-600 rounded-xl font-bold"><RefreshCw className="mr-2 w-4 h-4" />Sync Now</button>
                            </div>
                        ) : paginatedChannels.map((channel, cIdx) => (
                            <div key={channel.stream_id} className="flex border-b border-white/[0.03] hover:bg-white/[0.02] h-[80px]">
                                <div className="w-64 border-r border-white/10 shrink-0 flex items-center px-4 bg-[#05080f] z-10 sticky left-0 transition-colors">
                                    <span className="text-[10px] font-mono text-gray-600 w-6">{(currentPage - 1) * itemsPerPage + cIdx + 1}</span>
                                    <div className="w-12 h-12 rounded-lg bg-black/50 border border-white/5 flex items-center justify-center overflow-hidden mr-3">
                                        <FallbackImage src={channel.stream_icon} type="icon" className="w-full h-full object-contain p-1" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold truncate">{channel.name}</p>
                                        <p className="text-[10px] text-gray-500 truncate uppercase">HD • {channel.category_name}</p>
                                    </div>
                                    <button onClick={() => navigate('/live', { state: { channel } })} className="p-2 bg-blue-600 rounded-lg"><Play className="w-3 h-3 fill-white" /></button>
                                </div>
                                <div className="flex-1 relative overflow-hidden h-full">
                                    {fetchingEpgIds.has(channel.stream_id) ? (
                                        <div className="absolute inset-2 bg-blue-500/5 rounded-xl border border-dashed border-blue-500/20 flex items-center px-6 animate-pulse">
                                            <Loader2 className="w-3 h-3 text-blue-500 animate-spin mr-3" />
                                            <span className="text-[10px] uppercase font-black tracking-widest text-blue-400/60">Retrieving Schedule...</span>
                                        </div>
                                    ) : (epgData[channel.stream_id] && epgData[channel.stream_id].length > 0) ? (
                                        epgData[channel.stream_id].map((prog, pIdx) => {
                                            const programs = epgData[channel.stream_id];
                                            const width = getProgramWidth(prog, pIdx, programs);
                                            const offset = getProgramOffset(prog);
                                            if (offset + width < 0 || offset > HOUR_WIDTH * 3) return null;

                                            const start = parseEPGDate(prog.start, prog.start_timestamp);
                                            let stop = parseEPGDate(prog.end || prog.stop, prog.stop_timestamp || prog.end_timestamp);
                                            
                                            if (!stop && pIdx < programs.length - 1) {
                                                stop = parseEPGDate(programs[pIdx + 1].start, programs[pIdx + 1].start_timestamp);
                                            }
                                            if (!stop && start) {
                                                stop = new Date(start.getTime() + 60 * 60 * 1000);
                                            }

                                            const now = new Date();
                                            const isNow = start && stop && now >= start && now <= stop;

                                            return (
                                                <button
                                                    key={pIdx}
                                                    onClick={() => setSelectedProgram({ ...prog, _computedStart: start, _computedStop: stop, channel })}
                                                    className={clsx(
                                                        "absolute inset-y-2 rounded-xl border px-4 py-2 text-left transition-all overflow-hidden group/prog",
                                                        isNow ? "bg-blue-600/10 border-blue-500/30" : "bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10"
                                                    )}
                                                    style={{ left: offset, width: width - 8 }}
                                                >
                                                    <p className={clsx("text-xs font-bold truncate mb-1", isNow ? "text-blue-400" : "text-gray-300 group-hover/prog:text-white")}>
                                                        {decodeB64(prog.title)}
                                                    </p>
                                                    <p className="text-[10px] text-gray-500 font-medium font-mono">
                                                        {formatTime(start)} - {formatTime(stop)}
                                                    </p>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="absolute inset-2 bg-zinc-900/50 rounded-xl border border-dashed border-white/5 flex items-center px-6">
                                            <ShieldOff className="w-3 h-3 text-zinc-700 mr-3" />
                                            <span className="text-[10px] uppercase font-black tracking-widest text-zinc-600">No Programs Scheduled</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {!isLoading && visibleChannels.length > 0 && (
                    <footer className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between shrink-0">
                        <div className="text-xs text-gray-500">Showing <span className="text-white">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-white">{Math.min(currentPage * itemsPerPage, visibleChannels.length)}</span> of <span className="text-white">{visibleChannels.length}</span></div>
                        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5 shadow-inner">
                            <button onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1} className="p-2 hover:bg-white/10 rounded-lg transition-all disabled:opacity-20"><ChevronLeft className="w-5 h-5" /></button>
                            <div className="flex items-center px-4 gap-1 min-w-[100px] justify-center text-sm font-black"><span className="text-blue-500">{currentPage}</span><span className="text-zinc-600 px-1">/</span><span className="text-zinc-400">{totalPages}</span></div>
                            <button onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 hover:bg-white/10 rounded-lg transition-all disabled:opacity-20"><ChevronRight className="w-5 h-5" /></button>
                        </div>
                    </footer>
                )}
            </div>

            <AnimatePresence>
                {selectedProgram && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[100] flex items-center justify-center p-6" onClick={() => setSelectedProgram(null)}>
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-3xl" onClick={(e) => e.stopPropagation()}>
                            <div className="relative h-48 bg-blue-600/20 overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
                                <div className="absolute bottom-6 left-8 flex items-end gap-6">
                                    <div className="w-24 h-24 rounded-2xl bg-black border-2 border-white/10 shadow-2xl overflow-hidden">
                                        <FallbackImage src={selectedProgram.channel.stream_icon} type="icon" className="w-full h-full object-contain p-2" />
                                    </div>
                                    <div className="mb-2">
                                        <h4 className="text-blue-400 text-xs font-black uppercase tracking-[0.2em] mb-1">Program Details</h4>
                                        <h2 className="text-3xl font-black text-white leading-none">{selectedProgram.channel.name}</h2>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedProgram(null)} className="absolute top-6 right-6 p-2 bg-white/5 hover:bg-white/10 rounded-full text-white"><X className="w-6 h-6" /></button>
                            </div>
                            <div className="p-8">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="flex items-center gap-2 bg-blue-600/10 text-blue-400 px-3 py-1.5 rounded-full border border-blue-500/20">
                                        <Clock className="w-4 h-4" />
                                        <span className="text-xs font-bold">{formatTime(selectedProgram._computedStart || parseEPGDate(selectedProgram.start, selectedProgram.start_timestamp))} - {formatTime(selectedProgram._computedStop || parseEPGDate(selectedProgram.end || selectedProgram.stop, selectedProgram.stop_timestamp || selectedProgram.end_timestamp))}</span>
                                    </div>
                                    <div className="bg-white/5 text-gray-400 px-3 py-1.5 rounded-full border border-white/10 text-xs font-bold">{selectedProgram.channel.category_name}</div>
                                </div>
                                <h3 className="text-2xl font-bold text-white mb-4">{decodeB64(selectedProgram.title)}</h3>
                                <p className="text-gray-400 leading-relaxed text-sm mb-10">{selectedProgram.description ? decodeB64(selectedProgram.description) : "No description available."}</p>
                                <button onClick={() => navigate('/live', { state: { channel: selectedProgram.channel } })} className="w-full bg-white text-black py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3"><Play className="w-4 h-4 fill-black" /> Watch Now</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default TVGuide;
