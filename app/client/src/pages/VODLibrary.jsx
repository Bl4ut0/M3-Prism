import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { fetchSeriesInfo, fetchCachedVodCategories, fetchCachedVodItems, syncAllData, getContinueWatchingList } from '../api/api';
import {
    Play,
    Info,
    Search,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Filter,
    ChevronDown,
    X
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import FallbackImage from '../components/FallbackImage';
import VideoPlayer from '../components/VideoPlayer';

const VODLibrary = ({ type = 'movies' }) => {
    const { user, currentProvider, hiddenCategories } = useAuth();
    const location = useLocation();

    const isMovies = type === 'movies';

    // Data State
    const [content, setContent] = useState([]);
    const [categories, setCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAutoSyncing, setIsAutoSyncing] = useState(false);
    const autoSyncRef = useRef(false);

    // New: Continue Watching State
    const [continueWatchingItems, setContinueWatchingItems] = useState([]);

    // Filter State
    // Default to 'Continue Watching' category
    const [selectedCategory, setSelectedCategory] = useState({ id: 'continue_watching', name: 'Continue Watching' });
    const [searchQuery, setSearchQuery] = useState('');
    const [showHidden] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(24);

    // Extra effect to refresh continue watching when finishing playback or changing types
    useEffect(() => {
        if (user) {
            getContinueWatchingList(user.username, isMovies ? 'movie' : 'series')
                .then(items => setContinueWatchingItems(items || []));
        }
    }, [user, isMovies]);

    const fetchAllData = useCallback(async () => {
        if (!user || !currentProvider) return;
        setIsLoading(true);
        try {
            const providerId = currentProvider.id;
            const itemType = isMovies ? 'movie' : 'series';

            // 1. Try Local DB First for Everything
            const [localCats, localItems, cwList] = await Promise.all([
                fetchCachedVodCategories(providerId, itemType),
                fetchCachedVodItems(providerId, itemType),
                getContinueWatchingList(user.username, itemType)
            ]);

            setContinueWatchingItems(cwList || []);

            if ((!localCats || localCats.length === 0) && !autoSyncRef.current) {
                console.log("No cached VOD data. Triggering auto-sync...");
                autoSyncRef.current = true;
                setIsAutoSyncing(true);
                // Trigger Background Sync
                await syncAllData(providerId, user);

                // Re-fetch after sync
                const [newCats, newItems, newCw] = await Promise.all([
                    fetchCachedVodCategories(providerId, itemType),
                    fetchCachedVodItems(providerId, itemType),
                    getContinueWatchingList(user.username, itemType)
                ]);
                setCategories(newCats || []);
                setContent(newItems || []);
                setContinueWatchingItems(newCw || []);
            } else {
                setCategories(localCats || []);
                setContent(localItems || []);
            }

        } catch (error) {
            console.error(`Failed to load ${type} library`, error);
        } finally {
            autoSyncRef.current = false;
            setIsAutoSyncing(false);
            setIsLoading(false);
        }
    }, [user, currentProvider, type, isMovies]);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    // Filter Categories
    const visibleCategories = useMemo(() => {
        let baseCats = categories;
        if (!showHidden) {
            baseCats = categories.filter(c => {
                const id = String(c.category_id || c.id);
                return !hiddenCategories.includes(id);
            });
        }
        // Prepend Continue Watching
        return [
            { id: 'continue_watching', name: 'Continue Watching' },
            ...baseCats
        ];
    }, [categories, hiddenCategories, showHidden]);

    // Filtering logic
    const filteredContent = useMemo(() => {
        // Special Case: Continue Watching
        if (selectedCategory?.id === 'continue_watching') {
            let list = continueWatchingItems;
            if (searchQuery) {
                const lower = searchQuery.toLowerCase();
                list = list.filter(m => (m.name || m.title || '').toLowerCase().includes(lower));
            }
            return list;
        }

        let list = content;

        if (selectedCategory && selectedCategory.id !== 'continue_watching') {
            const catId = selectedCategory.category_id || selectedCategory.id;
            list = list.filter(m => {
                return String(m.category_id) === String(catId);
            });
        }

        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            list = list.filter(m => m.name.toLowerCase().includes(lower));
        }

        if (!showHidden) {
            list = list.filter(m => !hiddenCategories.includes(String(m.category_id)));
        }

        return list;
    }, [content, continueWatchingItems, selectedCategory, searchQuery, hiddenCategories, showHidden]);

    // Reset page on filter change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedCategory, searchQuery, itemsPerPage, type]);

    // Pagination Calculations
    const totalPages = Math.ceil(filteredContent.length / itemsPerPage);
    const paginatedContent = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredContent.slice(start, start + itemsPerPage);
    }, [filteredContent, currentPage, itemsPerPage]);

    const [playingMedia, setPlayingMedia] = useState(null);
    const [selectedSeries, setSelectedSeries] = useState(null);
    const [seriesEpisodes, setSeriesEpisodes] = useState({});
    const [loadingSeries, setLoadingSeries] = useState(false);
    const [activeSeason, setActiveSeason] = useState("1");

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
            const scrollArea = document.getElementById('media-scroll-area');
            if (scrollArea) scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handlePlay = useCallback(async (item) => {
        if (!isMovies) {
            // Series Logic
            let seriesIdToFetch = item.series_id || item.parent_id;
            if (!seriesIdToFetch && item.type === 'series') {
                // It's likely an episode recorded in history, parent_id IS the series_id
                seriesIdToFetch = item.parent_id;
            }

            if (!seriesIdToFetch) {
                // Fallback or error
                console.error("Cannot determine series ID", item);
                return;
            }

            setLoadingSeries(true);
            try {
                const data = await fetchSeriesInfo(currentProvider.url, user, seriesIdToFetch);
                if (data && data.episodes) {
                    setSeriesEpisodes(data.episodes);
                    const seasons = Object.keys(data.episodes);
                    setActiveSeason(seasons.length > 0 ? seasons[0] : "1");
                    // Merge info. If item is from history, it might have 'poster' instead of 'cover'
                    setSelectedSeries({
                        ...item,
                        series_id: seriesIdToFetch,
                        cover: item.cover || item.poster || item.stream_icon, // unify
                        info: data.info
                    });
                }
            } catch (err) {
                console.error("Failed to load series info", err);
            } finally {
                setLoadingSeries(false);
            }
            return;
        }

        // Movie Logic
        const baseUrl = currentProvider.url.endsWith('/') ? currentProvider.url.slice(0, -1) : currentProvider.url;
        const extension = item.container_extension || 'mp4';
        const url = `${baseUrl}/movie/${user.username}/${user.password}/${item.stream_id}.${extension}`;

        setPlayingMedia({
            ...item,
            url,
            poster: item.stream_icon || item.poster
        });
    }, [isMovies, currentProvider, user]);

    const playEpisode = (episode) => {
        const baseUrl = currentProvider.url.endsWith('/') ? currentProvider.url.slice(0, -1) : currentProvider.url;
        const extension = episode.container_extension || 'mp4';
        const url = `${baseUrl}/series/${user.username}/${user.password}/${episode.id}.${extension}`;

        setPlayingMedia({
            ...episode,
            name: `${selectedSeries.name} - S${episode.season}E${episode.episode_num} - ${episode.title}`,
            url,
            poster: selectedSeries.cover || selectedSeries.poster,
            parentId: selectedSeries.series_id || selectedSeries.parent_id || selectedSeries.id, // Ensure we pass series ID
            type: 'series'
        });
    };

    // Refresh Continue Watching when player closes
    useEffect(() => {
        if (!playingMedia && user) {
            getContinueWatchingList(user.username, isMovies ? 'movie' : 'series')
                .then(items => setContinueWatchingItems(items || []));
        }
    }, [playingMedia, user, isMovies]);

    // Handle deep-linking from GlobalSearch
    useEffect(() => {
        if (location.state?.item && user && currentProvider) {
            handlePlay(location.state.item);
            // Clear the state so a page refresh doesn't pop it open again
            window.history.replaceState({}, document.title);
        }
    }, [location.state, user, currentProvider, handlePlay]);

    return (
        <div className="flex h-full bg-[#05080f] overflow-hidden">
            {/* Sidebar for Categories */}
            <div className="w-64 flex flex-col border-r border-white/5 bg-black/40 backdrop-blur-md">
                <div className="p-6 border-b border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-400 uppercase text-xs tracking-wider">
                            {isMovies ? 'Movie' : 'Series'} Categories
                        </span>
                    </div>
                </div>

                {isAutoSyncing && (
                    <div className="mx-2 mt-2 p-4 bg-blue-600/10 border border-blue-500/20 rounded-xl">
                        <div className="flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                            <div>
                                <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">Auto-Cashing</p>
                                <p className="text-[10px] text-zinc-500 font-medium">Syncing {isMovies ? 'Movies' : 'Series'}...</p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin">
                    <button
                        onClick={() => setSelectedCategory(null)}
                        className={clsx(
                            "w-full text-left px-4 py-3 rounded-xl text-sm transition-all",
                            (!selectedCategory && selectedCategory?.id !== 'continue_watching') ? "bg-white/10 text-white shadow-lg" : "text-gray-400 hover:bg-white/5"
                        )}
                    >
                        All {isMovies ? 'Movies' : 'Series'}
                    </button>
                    {visibleCategories.map(cat => (
                        <button
                            key={cat.category_id || cat.id}
                            onClick={() => setSelectedCategory(cat)}
                            className={clsx(
                                "w-full text-left px-4 py-3 rounded-xl text-sm transition-all truncate",
                                (selectedCategory?.id === cat.id || selectedCategory?.category_id === cat.category_id) ? "bg-blue-600/20 text-blue-400 border border-blue-500/20 shadow-glow-sm" : "text-gray-400 hover:bg-white/5 hover:text-white"
                            )}
                        >
                            {cat.name || cat.category_name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {/* Header with Search & Info */}
                <header className="p-6 border-b border-white/5 bg-black/20 flex items-center justify-between backdrop-blur-sm z-10">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-bold text-white tracking-tight">
                            {selectedCategory ? (selectedCategory.name || selectedCategory.category_name) : `All ${isMovies ? 'Movies' : 'Series'}`}
                        </h1>
                        <p className="text-xs text-gray-500 font-medium tracking-wide">Found {filteredContent.length} titles</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative w-72">
                            <input
                                type="text"
                                placeholder={`Search ${type}...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-all focus:bg-white/10"
                            />
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        </div>
                    </div>
                </header>

                <div id="media-scroll-area" className="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-white/10">
                    {isLoading ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-40">
                            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                            <p className="text-gray-400 font-medium tracking-tight">Accessing Database...</p>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {paginatedContent.map((item, idx) => (
                                    <motion.div
                                        key={item.stream_id || item.series_id || idx}
                                        whileHover={{ y: -8, scale: 1.02 }}
                                        onClick={() => handlePlay(item)}
                                        className="group relative aspect-[2/3] bg-zinc-900 rounded-2xl overflow-hidden cursor-pointer shadow-2xl border border-white/5"
                                    >
                                        <FallbackImage
                                            src={item.stream_icon || item.cover || item.poster}
                                            alt={item.name}
                                            className="w-full h-full object-cover"
                                            type="poster"
                                        />

                                        {/* Hover Overlay - Explicit Click Handler */}
                                        <div
                                            onClick={(e) => { e.stopPropagation(); handlePlay(item); }}
                                            className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-4 z-20"
                                        >
                                            <div className="relative z-30 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                                                <div className="flex items-start gap-2 mb-2">
                                                    <div className="bg-white text-black p-1.5 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)] shrink-0 group-hover:scale-110 transition-transform mt-0.5">
                                                        {loadingSeries && (item.series_id === selectedSeries?.series_id) ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Play className="w-3 h-3 fill-current ml-0.5" />
                                                        )}
                                                    </div>
                                                    <p className="text-white font-bold text-[11px] leading-tight line-clamp-3 drop-shadow-md pt-0.5">{item.name}</p>
                                                </div>

                                                {/* Progress Bar for Continue Watching Items */}
                                                {selectedCategory?.id === 'continue_watching' && item.resume_time > 0 && item.duration > 0 && (
                                                    <div className="w-full h-1 bg-white/20 rounded-full mt-1 mb-2 overflow-hidden shadow-inner">
                                                        <div
                                                            className="h-full bg-blue-500 rounded-full relative"
                                                            style={{ width: `${(item.resume_time / item.duration) * 100}%` }}
                                                        >
                                                            <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/50 blur-[1px]" />
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-1.5 mt-auto pl-8">
                                                    {item.container_extension && (
                                                        <span className="text-[9px] text-zinc-300 font-bold border border-white/20 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-md uppercase">
                                                            {item.container_extension}
                                                        </span>
                                                    )}
                                                    <span className={clsx(
                                                        "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider backdrop-blur-md",
                                                        item.rating ? "bg-green-500/20 text-green-400 border border-green-500/20" : "bg-white/10 text-white/70 border border-white/10"
                                                    )}>
                                                        {item.rating ? `★ ${item.rating}` : (item.resume_time ? 'RESUME' : 'HD')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>

                            {filteredContent.length === 0 && (
                                <div className="h-40 flex flex-col items-center justify-center text-gray-500">
                                    <div className="p-4 bg-white/5 rounded-full mb-4 shadow-inner">
                                        <Filter className="w-8 h-8 opacity-20" />
                                    </div>
                                    <p className="font-medium">No results match your criteria</p>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Unified Pagination Footer */}
                {!isLoading && filteredContent.length > 0 && (
                    <footer className="p-4 border-t border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span className="font-medium">
                                Showing <span className="text-white">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-white">{Math.min(currentPage * itemsPerPage, filteredContent.length)}</span> of <span className="text-white">{filteredContent.length}</span>
                            </span>

                            <div className="h-4 w-px bg-white/10 mx-2" />

                            <div className="flex items-center gap-2 border border-white/10 bg-white/5 rounded-lg px-2 py-1 group hover:border-blue-500/30 transition-all">
                                <span className="text-[10px] font-bold uppercase opacity-50">Per Page:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                                    className="bg-transparent text-white focus:outline-none cursor-pointer font-bold appearance-none px-1"
                                >
                                    <option value="12" className="bg-zinc-900">12</option>
                                    <option value="24" className="bg-zinc-900">25</option>
                                    <option value="48" className="bg-zinc-900">50</option>
                                    <option value="96" className="bg-zinc-900">100</option>
                                </select>
                                <ChevronDown className="w-3 h-3 text-gray-500 group-hover:text-blue-500 transition-colors" />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5 shadow-inner">
                            <button
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all disabled:opacity-20 disabled:cursor-not-allowed group"
                            >
                                <ChevronLeft className="w-5 h-5 group-active:scale-90 transition-transform" />
                            </button>

                            <div className="flex items-center px-4 gap-1 min-w-[100px] justify-center">
                                <span className="text-sm font-black text-blue-500">{currentPage}</span>
                                <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em] px-1 overflow-hidden">/</span>
                                <span className="text-sm font-black text-zinc-400">{totalPages}</span>
                            </div>

                            <button
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all disabled:opacity-20 disabled:cursor-not-allowed group"
                            >
                                <ChevronRight className="w-5 h-5 group-active:scale-90 transition-transform" />
                            </button>
                        </div>
                    </footer>
                )}
            </div>

            {/* Series Detail Overlay */}
            <AnimatePresence>
                {selectedSeries && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed inset-0 z-40 bg-[#05080f] flex overflow-hidden"
                    >
                        {/* Beautiful Backdrop */}
                        {(selectedSeries.info?.backdrop_path && selectedSeries.info.backdrop_path.length > 0) || selectedSeries.backdrop || selectedSeries.cover ? (
                            <div className="absolute inset-0 z-0 select-none pointer-events-none">
                                <FallbackImage src={selectedSeries.info?.backdrop_path ? selectedSeries.info.backdrop_path[0] : (selectedSeries.backdrop || selectedSeries.cover)} type="backdrop" className="w-full h-full object-cover opacity-20" />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#05080f] via-[#05080f]/80 to-transparent" />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#05080f] via-[#05080f]/50 to-transparent" />
                            </div>
                        ) : null}

                        <div className="w-full h-full flex flex-col relative z-10 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 pb-12">
                            <div className="p-8 md:p-16 flex-1 flex flex-col pt-16 md:pt-24">
                                <button
                                    onClick={() => setSelectedSeries(null)}
                                    className="absolute top-8 right-8 z-50 bg-white/5 hover:bg-white/20 p-3 rounded-full transition-colors backdrop-blur-md border border-white/10 group"
                                >
                                    <X className="w-6 h-6 text-white group-hover:scale-90 transition-transform" />
                                </button>

                                <div className="flex flex-col md:flex-row gap-8 md:gap-16 items-start max-w-7xl mx-auto w-full">
                                    <div className="w-48 md:w-80 shrink-0 mx-auto md:mx-0">
                                        <div className="aspect-[2/3] rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/10 group">
                                            <FallbackImage
                                                src={selectedSeries.cover}
                                                type="poster"
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex-1 flex flex-col max-w-3xl">
                                        {selectedSeries.info?.director && <span className="text-blue-400 font-bold uppercase tracking-widest text-xs mb-3">{selectedSeries.info.director}</span>}
                                        <h2 className="text-4xl md:text-6xl font-black text-white mb-6 tracking-tight leading-tight drop-shadow-lg">{selectedSeries.name}</h2>
                                        
                                        <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-zinc-300 mb-8 border-b border-white/10 pb-8">
                                            {selectedSeries.rating && <span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-lg border border-green-500/20">{selectedSeries.rating}</span>}
                                            {selectedSeries.info?.releaseDate ? <span>{selectedSeries.info.releaseDate}</span> : (selectedSeries.info?.releasedate && <span>{selectedSeries.info.releasedate}</span>)}
                                            {selectedSeries.info?.genre && <span>{selectedSeries.info.genre}</span>}
                                        </div>

                                        {selectedSeries.info?.plot && (
                                            <p className="text-zinc-400 text-lg leading-relaxed mb-12 drop-shadow-md">{selectedSeries.info.plot}</p>
                                        )}

                                        {Object.keys(seriesEpisodes).length > 0 && (
                                            <div className="flex flex-col flex-1">
                                                {/* Tabs */}
                                                <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none border-b border-white/5">
                                                    {Object.keys(seriesEpisodes).map((season) => (
                                                        <button
                                                            key={season}
                                                            onClick={() => setActiveSeason(season)}
                                                            className={clsx(
                                                                "px-6 py-2.5 rounded-t-xl text-sm font-bold whitespace-nowrap transition-all",
                                                                activeSeason === season 
                                                                    ? "bg-white/10 text-white shadow-lg border-b-2 border-white" 
                                                                    : "text-zinc-500 hover:bg-white/5 hover:text-white"
                                                            )}
                                                        >
                                                            Season {season}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Episodes List Grid */}
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {seriesEpisodes[activeSeason]?.map(ep => (
                                                        <div
                                                            key={ep.id}
                                                            onClick={() => playEpisode(ep)}
                                                            className="flex flex-col justify-end relative h-32 md:h-40 rounded-2xl cursor-pointer overflow-hidden group shadow-lg bg-zinc-900"
                                                        >
                                                            <div className="absolute inset-0 bg-white/5 group-hover:scale-105 transition-transform duration-500 z-0">
                                                                {(ep.info?.movie_image || ep.info?.cover) && (
                                                                    <FallbackImage src={ep.info.movie_image || ep.info.cover} type="backdrop" className="w-full h-full object-cover opacity-40 group-hover:opacity-70 transition-opacity" />
                                                                )}
                                                            </div>
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-10" />
                                                            
                                                            <div className="relative z-20 p-4 transition-transform duration-300 group-hover:translate-y-[-4px]">
                                                                <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mb-2 mx-1 shadow-[0_0_15px_rgba(0,0,0,0.5)] group-hover:bg-white group-hover:text-black transition-colors">
                                                                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                                                </div>
                                                                <p className="text-white font-bold truncate text-base mb-1 px-1 drop-shadow-md">
                                                                    {ep.episode_num}. {ep.title}
                                                                </p>
                                                                {(ep.duration || ep.container_extension) && (
                                                                    <p className="text-[10px] text-zinc-400 font-bold px-1 uppercase tracking-widest">
                                                                        {ep.container_extension} {ep.duration ? `• ${Math.round(ep.duration / 60)}M` : ''}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Video Player Overlay */}
            <AnimatePresence>
                {playingMedia && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black flex flex-col"
                    >
                        <div className="absolute top-4 right-4 z-50">
                            <button
                                onClick={() => setPlayingMedia(null)}
                                className="bg-black/50 hover:bg-white/20 text-white p-2 rounded-full transition-colors backdrop-blur-md"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 w-full h-full">
                            <VideoPlayer
                                src={playingMedia.url}
                                className="w-full h-full"
                                autoPlay={true}
                                vodMode={true}
                                streamId={playingMedia.stream_id || playingMedia.id} // Supports both Movie and Episode ID
                                title={playingMedia.name}
                                poster={playingMedia.poster}
                                parentId={playingMedia.parentId}
                                type={playingMedia.type || (isMovies ? 'movie' : 'series')}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default VODLibrary;
