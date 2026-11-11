import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { 
    getRecentChannels, 
    getContinueWatchingList, 
    fetchCachedVodItems,
    getCachedEPG,
    fetchXtreamData
} from '../api/api';
import FallbackImage from '../components/FallbackImage';
import { Play, Clock, Flame, Film, Clapperboard, ChevronRight, Tv } from 'lucide-react';
import { motion } from 'framer-motion';

const decodeB64 = (str) => {
    if (!str) return '';
    if (str.includes(' ')) return str;
    try {
        return decodeURIComponent(escape(atob(str)));
    } catch {
        return str;
    }
};

const Dashboard = () => {
    const { user, currentProvider } = useAuth();
    const navigate = useNavigate();

    const [recentChannels, setRecentChannels] = useState([]);
    const [channelEPG, setChannelEPG] = useState({});
    
    const [continueMovies, setContinueMovies] = useState([]);
    const [continueSeries, setContinueSeries] = useState([]);
    
    const [recentlyAdded, setRecentlyAdded] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadDashboardData = useCallback(async () => {
        setIsLoading(true);
        try {
            const pid = currentProvider.id;

            // Load Recents & Continue Watching
            const [chans, cmovies, cseries, allMovies] = await Promise.all([
                getRecentChannels(pid),
                getContinueWatchingList(user.username, 'movie'),
                getContinueWatchingList(user.username, 'series'),
                fetchCachedVodItems(pid, 'movie').catch(()=>[])
            ]);

            setRecentChannels(chans || []);
            setContinueMovies(cmovies || []);
            setContinueSeries(cseries || []);
            
            // Just take a slice to simulate Recently Added for now
            // Reverse so they look 'newest first' if the list is sequential ID
            if (allMovies && allMovies.length > 0) {
                setRecentlyAdded(allMovies.slice(-20).reverse().slice(0, 10));
            } else {
                setRecentlyAdded([]);
            }

            // Fire off EPG fetches for recent channels
            if (chans && chans.length > 0) {
                chans.slice(0, 8).forEach(async (ch) => {
                    try {
                        const cached = await getCachedEPG(ch.stream_id, pid);
                        if (cached?.epg_listings?.length > 0) {
                            setChannelEPG(prev => ({...prev, [ch.stream_id]: cached.epg_listings[0]}));
                            return;
                        }
                        if (currentProvider.type !== 'm3u') {
                            const data = await fetchXtreamData(currentProvider.url, {
                                username: user.username,
                                password: user.password,
                                action: 'get_short_epg',
                                stream_id: ch.stream_id
                            });
                            if (data?.epg_listings?.length > 0) {
                                setChannelEPG(prev => ({
                                    ...prev, 
                                    [ch.stream_id]: {
                                        title: decodeB64(data.epg_listings[0].title),
                                        description: decodeB64(data.epg_listings[0].description)
                                    }
                                }));
                            }
                        }
                    } catch { /* A missing guide entry should not fail the dashboard. */ }
                });
            }

        } catch (e) {
            console.error("Dashboard Load Error:", e);
        } finally {
            setIsLoading(false);
        }
    }, [currentProvider, user]);

    useEffect(() => {
        if (user && currentProvider) {
            loadDashboardData();
        }
    }, [user, currentProvider, loadDashboardData]);

    const handlePlayVod = (item, type = 'movies') => {
        navigate(`/${type}`, { state: { item } });
    };

    const handlePlayChannel = (channel) => {
        navigate(`/live`, { state: { channel: { stream_id: channel.stream_id, name: channel.name, stream_icon: channel.stream_icon, num: 0 } } });
    };

    // Combine Continue Watching
    const continueAll = [...continueMovies.map(m=>({...m, _type: 'movies'})), ...continueSeries.map(s=>({...s, _type: 'series'}))];

    return (
        <div className="h-full bg-[#05080f] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 pb-20">
            {/* Header Banner */}
            <div className="relative pt-20 pb-12 px-8 lg:px-12 border-b border-white/5 bg-gradient-to-b from-blue-600/10 to-transparent">
                <div className="absolute inset-0 bg-black/60 z-0" />
                <div className="relative z-10">
                    <h1 className="text-4xl font-black text-white tracking-tight drop-shadow-md mb-2">Welcome Back,</h1>
                    <p className="text-blue-400 font-bold uppercase tracking-widest text-sm">{currentProvider?.name || 'Guest User'}</p>
                </div>
            </div>

            <div className="px-8 lg:px-12 py-8 space-y-12">
                
                {/* 1. Continue Watching Carousel */}
                {continueAll.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Clock className="w-5 h-5 text-teal-400" /> Continue Watching</h2>
                        </div>
                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-white/10">
                            {continueAll.map((item, idx) => (
                                <motion.div 
                                    key={`cw-${item.stream_id || item.series_id || idx}`}
                                    whileHover={{ y: -4, scale: 1.02 }}
                                    className="relative flex-none w-64 aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-white/10 group cursor-pointer shadow-xl"
                                    onClick={() => handlePlayVod(item, item._type)}
                                >
                                    <FallbackImage src={item.cover || item.poster || item.stream_icon} type="backdrop" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                                    
                                    <div className="absolute bottom-0 left-0 right-0 p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                                                <Play className="w-3 h-3 fill-current ml-0.5" />
                                            </div>
                                            <p className="text-white font-bold text-xs truncate max-w-[150px]">{item.title || item.name}</p>
                                        </div>
                                        {/* Progress Bar */}
                                        {item.resume_time > 0 && item.duration > 0 && (
                                            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                                                <div className="h-full bg-teal-400" style={{ width: `${(item.resume_time / item.duration) * 100}%` }} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
                                        {item._type === 'movies' ? <Film className="w-3 h-3 text-gray-300" /> : <Clapperboard className="w-3 h-3 text-gray-300" />}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </section>
                )}

                {/* 2. Recent Channels Mini TV Guide */}
                {recentChannels.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Tv className="w-5 h-5 text-blue-400" /> Recent Channels</h2>
                            <button onClick={() => navigate('/live')} className="text-xs font-bold text-blue-400 hover:text-white uppercase tracking-wider flex items-center gap-1 transition-colors">
                                TV Player <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            {recentChannels.slice(0, 8).map((ch) => {
                                const prog = channelEPG[ch.stream_id];
                                return (
                                    <motion.div 
                                        key={`rec-${ch.stream_id}`}
                                        whileHover={{ y: -2 }}
                                        onClick={() => handlePlayChannel(ch)}
                                        className="bg-white/5 border border-white/5 hover:border-blue-500/30 rounded-xl p-4 flex gap-4 cursor-pointer transition-all group shadow-md hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                                    >
                                        <div className="w-16 h-16 rounded-xl bg-black/40 p-2 flex items-center justify-center shrink-0 border border-white/10 shadow-inner group-hover:scale-105 transition-transform">
                                            <FallbackImage src={ch.stream_icon} type="icon" className="w-full h-full object-contain drop-shadow-md" />
                                        </div>
                                        <div className="flex flex-col justify-center overflow-hidden flex-1">
                                            <h3 className="text-white font-bold text-sm truncate group-hover:text-blue-400 transition-colors">{ch.name}</h3>
                                            <p className="text-zinc-500 text-[10px] mt-1 line-clamp-2">
                                                {prog ? (prog.title || prog.description) : 'No EPG Available'}
                                            </p>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* 3. Recently Added Movies (Simulation) */}
                {recentlyAdded.length > 0 && (
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="flex items-center gap-2 text-xl font-bold text-white"><Flame className="w-5 h-5 text-purple-400" /> Recently Added Movies</h2>
                            <button onClick={() => navigate('/movies')} className="text-xs font-bold text-purple-400 hover:text-white uppercase tracking-wider flex items-center gap-1 transition-colors">
                                View Library <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
                            {recentlyAdded.map((movie) => (
                                <motion.div 
                                    key={`add-${movie.stream_id}`}
                                    whileHover={{ y: -4, scale: 1.03 }}
                                    onClick={() => handlePlayVod(movie, 'movies')}
                                    className="group aspect-[2/3] bg-zinc-900 rounded-xl overflow-hidden cursor-pointer shadow-lg border border-white/5 relative"
                                >
                                    <FallbackImage src={movie.stream_icon || movie.poster} type="poster" className="w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-75" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                                        <h3 className="text-white font-bold text-xs truncate">{movie.name}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            {movie.rating && <span className="text-[8px] bg-green-500/20 text-green-400 px-1 py-0.5 rounded font-bold border border-green-500/20 uppercase tracking-widest">★{movie.rating}</span>}
                                            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">{movie.container_extension || 'MP4'}</span>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </section>
                )}

                {isLoading && (
                    <div className="flex items-center justify-center p-8 opacity-50">
                        <div className="w-8 h-8 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
