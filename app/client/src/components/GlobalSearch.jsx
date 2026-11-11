import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { globalSearch, getAssetUrl } from '../api/api';
import { useAuth } from '../context/auth-context';
import { Search, X, Tv, Film, Clapperboard, Loader2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SECTION_STYLES = {
    channel: { icon: Tv, color: 'text-blue-400', title: 'Live Channels' },
    movie: { icon: Film, color: 'text-purple-400', title: 'Movies' },
    series: { icon: Clapperboard, color: 'text-pink-400', title: 'Series' },
};

const GlobalSearch = ({ isOpen, onClose }) => {
    const { currentProvider } = useAuth();
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const debounceTimeout = useRef(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const focusTimer = setTimeout(() => {
            inputRef.current?.focus();
            setQuery('');
            setResults(null);
        }, 100);
        return () => clearTimeout(focusTimer);
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSearch = useCallback((value) => {
        setQuery(value);
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        if (value.length < 2) {
            setResults(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        debounceTimeout.current = setTimeout(async () => {
            const data = await globalSearch(value, currentProvider?.id);
            setResults(data);
            setLoading(false);
        }, 300);
    }, [currentProvider]);

    const handleItemClick = (item, type) => {
        onClose();
        if (type === 'channel') {
            navigate('/live', { state: { channel: item } });
        } else if (type === 'movie') {
            navigate('/movies', { state: { item } });
        } else if (type === 'series') {
            navigate('/series', { state: { item } });
        }
    };

    const renderSection = (type, items) => {
        if (!items?.length) {
            return null;
        }

        const section = SECTION_STYLES[type];
        const Icon = section.icon;

        return (
            <div className="mb-4">
                <div className="flex items-center gap-2 px-4 py-2">
                    <Icon className={`w-3.5 h-3.5 ${section.color}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${section.color}`}>{section.title}</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">{items.length} results</span>
                </div>
                <div className="space-y-0.5">
                    {items.map((item, idx) => (
                        <button
                            key={`${type}-${item.stream_id || item.series_id || idx}`}
                            onClick={() => handleItemClick(item, type)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-all text-left group rounded-lg mx-1"
                        >
                            <div className="w-8 h-8 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                                {(item.stream_icon || item.cover) ? (
                                    <img
                                        src={getAssetUrl(item.stream_icon || item.cover)}
                                        alt=""
                                        className="w-full h-full object-cover"
                                        onError={(event) => { event.target.style.display = 'none'; }}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Icon className="w-3.5 h-3.5 text-zinc-600" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white truncate font-medium group-hover:text-blue-400 transition-colors">{item.name}</div>
                                {item.rating && <span className="text-[10px] text-zinc-500">Rating: {item.rating}</span>}
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-white transition-colors flex-shrink-0" />
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    if (!isOpen) {
        return null;
    }

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 backdrop-blur-xl z-[100] flex items-start justify-center pt-[15vh]"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="w-full max-w-xl bg-zinc-900/95 border border-white/10 rounded-2xl shadow-3xl overflow-hidden"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                        <Search className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(event) => handleSearch(event.target.value)}
                            placeholder="Search channels, movies, series..."
                            className="flex-1 bg-transparent text-white text-base font-medium focus:outline-none placeholder:text-zinc-600"
                        />
                        {loading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />}
                        <div className="flex items-center gap-2">
                            <kbd className="hidden sm:block text-[10px] text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded font-mono border border-zinc-700">ESC</kbd>
                            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg transition-colors">
                                <X className="w-4 h-4 text-zinc-500" />
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[50vh] overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-white/10">
                        {!results && !loading && query.length < 2 && (
                            <div className="py-12 text-center">
                                <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                                <p className="text-zinc-600 text-sm">Start typing to search across all content</p>
                                <p className="text-zinc-700 text-[10px] mt-2 uppercase tracking-widest font-bold">
                                    Tip: <kbd className="bg-zinc-800 px-1.5 py-0.5 rounded font-mono border border-zinc-700">Ctrl/Cmd+K</kbd> to open anytime
                                </p>
                            </div>
                        )}

                        {results && results.total === 0 && (
                            <div className="py-12 text-center">
                                <p className="text-zinc-500 text-sm">No results for "<span className="text-white">{query}</span>"</p>
                            </div>
                        )}

                        {results && results.total > 0 && (
                            <>
                                {renderSection('channel', results.channels)}
                                {renderSection('movie', results.movies)}
                                {renderSection('series', results.series)}
                            </>
                        )}
                    </div>

                    {results && results.total > 0 && (
                        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
                            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">{results.total} total results</span>
                            <span className="text-[10px] text-zinc-700">Provider: <span className="text-zinc-500">{currentProvider?.name || 'All'}</span></span>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default GlobalSearch;
