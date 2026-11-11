import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import {
    saveWatchProgress,
    getWatchProgress,
    getDirectStreamUrl,
    isServerlessMode,
    getNativeRelay,
    isNativeRelayAvailable,
    resolveStreamUrlForPlayback
} from '../api/api';

function createRelayHlsLoader() {
    const DefaultLoader = Hls?.DefaultConfig?.loader;
    const relay = getNativeRelay();
    if (!DefaultLoader || !relay) return undefined;

    return class RelayHlsLoader extends DefaultLoader {
        load(context, config, callbacks) {
            const url = context?.url || '';
            const isHttpOnHttps = typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(url);
            if (!isHttpOnHttps && !isNativeRelayAvailable()) {
                return super.load(context, config, callbacks);
            }
            const tRequest = performance.now();
            const isBinary = context.responseType === 'arraybuffer';
            relay.fetch(url, {
                responseType: isBinary ? 'arraybuffer' : 'text',
                timeout: config?.loadPolicy?.default?.maxLoadTimeMs || 25000
            }).then(async (res) => {
                if (!res.ok) {
                    callbacks.onError({ code: res.status || 502, text: res.statusText || 'Relay fetch error' }, context, null, {});
                    return;
                }
                const data = isBinary ? await res.arrayBuffer() : await res.text();
                const tLoaded = performance.now();
                const total = isBinary ? data.byteLength : data.length;
                const stats = {
                    aborted: false,
                    loaded: total,
                    total,
                    retry: 0,
                    chunkCount: 1,
                    bwEstimate: 0,
                    loading: { start: tRequest, first: tLoaded, end: tLoaded },
                    parsing: { start: tLoaded, end: tLoaded },
                    buffering: { start: tLoaded, first: tLoaded, end: tLoaded }
                };
                callbacks.onSuccess({ url: res.url || url, data }, stats, context, null);
            }).catch((err) => {
                if (!isHttpOnHttps) {
                    super.load(context, config, callbacks);
                    return;
                }
                callbacks.onError({ code: 0, text: err.message || 'Relay network error' }, context, null, {});
            });
        }
    };
}
import { useAuth } from '../context/auth-context';
import {
    VolumeX,
    Volume2,
    Settings,
    Shield,
    ShieldOff,
    Zap,
    ZapOff,
    Check,
    X,
    Play,
    Pause,
    FastForward,
    Radio,
    Maximize2,
    Copy,
    Cast,
    RotateCcw,
    MonitorPlay,
    Activity,
    PictureInPicture2
} from 'lucide-react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';

const VideoPlayer = ({ src, className, autoPlay = true, vodMode = false, streamId, title, poster, parentId, type }) => {
    const { user } = useAuth();
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const mpegtsRef = useRef(null);
    const containerRef = useRef(null);
    const progressInterval = useRef(null);
    const lastTimeRef = useRef(0);
    const stallCounterRef = useRef(0);
    const isDraggingRef = useRef(false);

    // States
    const [mediaStats, setMediaStats] = useState({ width: 0, height: 0, hasAudio: null });
    const [useProxy, setUseProxy] = useState(true);
    const [isStable, setIsStable] = useState(true);
    const [isMuted, setIsMuted] = useState(autoPlay);
    const [isAutoMuted, setIsAutoMuted] = useState(autoPlay);
    const [showAutoMuteOverlay, setShowAutoMuteOverlay] = useState(autoPlay);
    const [volume, setVolume] = useState(1); // 0 to 1
    const [prevVolume, setPrevVolume] = useState(1);
    const [isPlaying, setIsPlaying] = useState(autoPlay);
    const [isBuffering, setIsBuffering] = useState(false);
    const [error, setError] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [isLive, setIsLive] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isDragging, setIsDragging] = useState(false); // Scrubber dragging
    const [, setIsStalled] = useState(false);

    // Save Progress Interval
    useEffect(() => {
        if (!vodMode || !streamId || !user) return;

        progressInterval.current = setInterval(() => {
            if (videoRef.current && !videoRef.current.paused) {
                saveWatchProgress(
                    user.username,
                    streamId,
                    type || (src.includes('/series/') ? 'series' : 'movie'), // fallback inference
                    parentId || null,
                    title,
                    poster,
                    videoRef.current.currentTime,
                    videoRef.current.duration
                );
            }
        }, 10000); // Save every 10 seconds

        return () => clearInterval(progressInterval.current);
    }, [vodMode, streamId, user, title, poster, parentId, type, src]);

    function jumpToLive(e) {
        if (e) e.stopPropagation();
        const video = videoRef.current;
        if (!video) return;

        let edge = 0;
        const seekable = video.seekable;
        if (video.duration && Number.isFinite(video.duration)) {
            edge = video.duration;
        } else if (seekable && seekable.length > 0) {
            edge = seekable.end(seekable.length - 1);
        }

        if (edge > 0) video.currentTime = Math.max(0, edge - 3);
        if (video.paused) video.play().catch(() => {});
    }

    // Auto-hide the mute overlay after 4 seconds
    useEffect(() => {
        if (isAutoMuted && showAutoMuteOverlay) {
            const timer = setTimeout(() => setShowAutoMuteOverlay(false), 4000);
            return () => clearTimeout(timer);
        }
    }, [isAutoMuted, showAutoMuteOverlay]);

    const toggleFullscreen = (e) => {
        if (e) e.stopPropagation();
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    // Stall Watcher (Detects if video is "playing" but time isn't advancing)
    useEffect(() => {
        if (!isPlaying || isBuffering || isDragging || !videoRef.current) return;

        const interval = setInterval(() => {
            const video = videoRef.current;
            if (!video) return;

            if (video.currentTime === lastTimeRef.current && !video.paused) {
                stallCounterRef.current += 1;
                if (stallCounterRef.current >= 5) { // 5 checks (2.5s) of no movement
                    console.warn("[Player] Stall detected, attempting resync...");
                    setIsStalled(true);
                    if (!vodMode) {
                        jumpToLive();
                    }
                }
            } else {
                stallCounterRef.current = 0;
                setIsStalled(false);
            }
            lastTimeRef.current = video.currentTime;
        }, 500);

        return () => clearInterval(interval);
    }, [isPlaying, isBuffering, isDragging, vodMode]);

    // Listen for fullscreen change events (e.g. if user presses Esc)
    useEffect(() => {
        const handleFSChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFSChange);
        return () => document.removeEventListener('fullscreenchange', handleFSChange);
    }, []);

    // Proxy config effect removed to respect default "false" state as requested

    // Remote playback is relayed through the authenticated server in desktop/server mode,
    // or through the PortfoliOS Native Relay in serverless web mode.
    const serverlessMode = isServerlessMode();
    const forceProxy = !serverlessMode && typeof src === 'string' && src.startsWith('http');
    const allowDirectPlayback = serverlessMode || !forceProxy;
    const shouldProxy = serverlessMode ? isNativeRelayAvailable() : (forceProxy || useProxy);
    const resolvedSrc = !src
        ? null
        : serverlessMode
            ? resolveStreamUrlForPlayback(src)
            : shouldProxy && src.startsWith('http')
                ? `${window.location.origin}/api/proxy?url=${encodeURIComponent(src)}`
                : src;
    const directSourceUrl = allowDirectPlayback && src?.startsWith('http') ? getDirectStreamUrl(src) : null;
    const isTs = resolvedSrc?.toLowerCase().includes('.ts');

    useEffect(() => {
        if (!src) return;
        const resetTimer = setTimeout(() => setMediaStats({ width: 0, height: 0, hasAudio: null }), 0);
        return () => clearTimeout(resetTimer);
    }, [src]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = volume;
        video.muted = isMuted;
    }, [volume, isMuted]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !resolvedSrc) return;

        const stateTimer = setTimeout(() => {
            setError(null);
            setIsBuffering(true);
        }, 0);

        // Clean up previous instances
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (mpegtsRef.current) {
            mpegtsRef.current.destroy();
            mpegtsRef.current = null;
        }

        // Construct URL: Use Proxy if enabled
        let streamUrl = resolvedSrc;

        // Monitor state
        const handleWaiting = () => setIsBuffering(true);
        const handlePlaying = () => {
            setIsBuffering(false);
            setIsPlaying(true);
        };
        const handlePause = () => setIsPlaying(false);
        const handleTimeUpdate = () => {
            const video = videoRef.current;
            if (!video) return;

            // Media Stats Dynamic Reading
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                setMediaStats(prev => (prev.width !== video.videoWidth || prev.height !== video.videoHeight) ? 
                    { ...prev, width: video.videoWidth, height: video.videoHeight } : prev);
            }
            // Chromium exposes decoded byte counts
            if (video.webkitAudioDecodedByteCount !== undefined) {
                if (video.webkitAudioDecodedByteCount > 0) {
                    setMediaStats(prev => prev.hasAudio !== true ? { ...prev, hasAudio: true } : prev);
                } else if (video.currentTime > 3 && !video.paused) {
                    // If no audio downloaded after 3 seconds of playing, it's very likely mute
                    setMediaStats(prev => prev.hasAudio !== false ? { ...prev, hasAudio: false } : prev);
                }
            }

            // Update UI state if not dragging
            if (!isDraggingRef.current) {
                setCurrentTime(video.currentTime);
                setDuration(video.duration || 0);
            }

            // Accurate live edge detection for different formats
            let edge = 0;
            if (video.duration && isFinite(video.duration)) {
                edge = video.duration;
            } else if (video.seekable && video.seekable.length > 0) {
                edge = video.seekable.end(video.seekable.length - 1);
            }

            if (edge > 0) {
                const diff = edge - video.currentTime;
                // Only show "Go Live" if more than 30s behind to prevent buffering loops
                setIsLive(diff < 30);
            }
        };

        const handleLoadedMetadata = () => {
            const video = videoRef.current;
            if (!video) return;
            setDuration(video.duration);
            
            // Set initial resolution if available
            if (video.videoWidth > 0) {
                setMediaStats(prev => ({ ...prev, width: video.videoWidth, height: video.videoHeight }));
            }

            // Resume Playback Logic
            if (vodMode && streamId && user) {
                getWatchProgress(user.username, streamId).then(data => {
                    if (data && data.resume_time > 10 && data.resume_time < (video.duration - 10)) {
                        console.log(`Resuming at ${data.resume_time}s`);
                        // Ensure we don't scrub before data is ready
                        const attemptSeek = () => {
                            if (video.seekable.length > 0) {
                                video.currentTime = data.resume_time;
                            } else {
                                setTimeout(attemptSeek, 500);
                            }
                        };
                        attemptSeek();
                    }
                });
            }
        };

        const handleError = () => {
            if (video.error && (video.error.code === 4 || video.error.code === 2) && !shouldProxy) {
                console.warn("Direct connection failed. Auto-switching to Proxy...");
                setUseProxy(true);
                setError(null); // Clear error to allow retry
            } else if (video.error) {
                setError(`Playback Error (${video.error.code}): Connection lost.`);
            }
        };

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('error', handleError);

        if (isTs && mpegts.getFeatureList().mseLivePlayback && !vodMode) {
            // Only use MPEGTS for Live TS Streams
            const player = mpegts.createPlayer({
                type: 'mse',
                isLive: true,
                url: streamUrl,
                cors: true
            }, {
                enableWorker: true,
                stashInitialSize: isStable ? 1024 * 1024 * 8 : 1024 * 512,
                lazyLoad: false,
                autoCleanupSourceBuffer: true,
                liveBufferLatencyChasing: !isStable,
                liveBufferLatencyMaxLatency: isStable ? 30 : 5,
                liveBufferLatencyMinLatency: isStable ? 2 : 1
            });

            mpegtsRef.current = player;
            player.attachMediaElement(video);
            player.load();

            player.on(mpegts.Events.ERROR, (type) => {
                if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
                    setError("Network Error: Stream source unreachable.");
                }
            });

            if (autoPlay) {
                video.play().catch(e => {
                    if (e.name !== 'AbortError') console.warn("Autoplay blocked", e);
                });
            }
        } else if (!isTs && Hls.isSupported() && streamUrl.includes('.m3u8')) {
            // Only use HLS for .m3u8 manifests
            const CustomLoader = serverlessMode ? createRelayHlsLoader() : undefined;
            const hls = new Hls({
                enableWorker: !CustomLoader,
                lowLatencyMode: !isStable,
                backBufferLength: 300,
                maxBufferLength: isStable ? 120 : 30,
                ...(CustomLoader ? { loader: CustomLoader } : {})
            });

            hlsRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (autoPlay) {
                    video.play().catch(e => {
                        if (e.name !== 'AbortError') console.warn("Autoplay blocked", e);
                    });
                }
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            setError("HLS fatal error.");
                            break;
                    }
                }
            });

        } else {
            // Native Playback (MP4, MKV, VOD) - Most Robust for Movies/Series
            console.log("Using Native Playback for VOD");
            video.src = streamUrl;
            if (autoPlay) {
                video.play().catch(e => {
                    if (e.name !== 'AbortError') console.warn("Autoplay blocked", e);
                });
            }
        }

        return () => {
            clearTimeout(stateTimer);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('error', handleError);
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (mpegtsRef.current) {
                mpegtsRef.current.destroy();
                mpegtsRef.current = null;
            }
        };
    }, [resolvedSrc, isStable, autoPlay, shouldProxy, isTs, streamId, user, vodMode]);

    const togglePlay = (e) => {
        if (e) e.stopPropagation();
        const video = videoRef.current;
        if (video) {
            if (video.paused) {
                // If resuming a Live stream, jump to edge to prevent playback from old buffer
                if (!vodMode) {
                    jumpToLive();
                }
                video.play().catch(err => {
                    if (err.name !== 'AbortError') console.error("Playback failed:", err);
                });
            } else {
                video.pause();
            }
        }
    };

    const toggleMute = (e) => {
        if (e) e.stopPropagation();
        if (videoRef.current) {
            const newMuted = !videoRef.current.muted;
            videoRef.current.muted = newMuted;
            setIsMuted(newMuted);

            // User interacted, so no longer "auto-muted"
            if (isAutoMuted) {
                setIsAutoMuted(false);
                setShowAutoMuteOverlay(false);
            }

            // If unmuting and volume is 0, give it some sound
            if (!newMuted && volume === 0) {
                const volts = prevVolume > 0 ? prevVolume : 0.5;
                videoRef.current.volume = volts;
                setVolume(volts);
            }
        }
    };

    const handleVolumeChange = (e) => {
        const value = parseFloat(e.target.value);
        setVolume(value);

        // Interaction clears auto-mute
        if (isAutoMuted) {
            setIsAutoMuted(false);
            setShowAutoMuteOverlay(false);
        }

        if (videoRef.current) {
            videoRef.current.volume = value;
            if (value > 0 && isMuted) {
                videoRef.current.muted = false;
                setIsMuted(false);
            } else if (value === 0 && !isMuted) {
                videoRef.current.muted = true;
                setIsMuted(true);
            }
        }
        if (value > 0) setPrevVolume(value);
    };

    const [copied, setCopied] = useState(false);

    const handleCopyUrl = () => {
        if (!directSourceUrl) {
            return;
        }
        navigator.clipboard.writeText(directSourceUrl || src).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleSeek = (e) => {
        const value = parseFloat(e.target.value);
        setCurrentTime(value);
        if (videoRef.current) {
            videoRef.current.currentTime = value;
        }
    };

    const handleScrubStart = () => {
        isDraggingRef.current = true;
        setIsDragging(true);
    };
    const handleScrubEnd = (e) => {
        isDraggingRef.current = false;
        setIsDragging(false);
        const value = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = value;
        }
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return "00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const handleCast = () => {
        // Basic Cast Sender placeholder
        // In a real implementation, this would invoke chrome.cast.requestSession()
        window.open(resolvedSrc || src, '_blank'); // Temporary: open in new tab (some browsers may trigger cast)
        alert("Cast support requires a secure context (HTTPS) and registered Cast Sender ID. For now, opening stream directly.");
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black group overflow-hidden rounded-xl border border-white/5 shadow-2xl"
        >
            <video
                ref={videoRef}
                className={clsx("w-full h-full object-contain cursor-pointer", className)}
                playsInline
                muted={isMuted}
                onClick={togglePlay}
                disableRemotePlayback
            />

            {/* Error Overlay */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 z-[100] p-6 text-center animate-in fade-in duration-300">
                    <div className="max-w-md bg-zinc-900 border border-red-500/20 p-8 rounded-3xl shadow-3xl text-white">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <ShieldOff className="w-8 h-8 text-red-500" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Stream Unavailable</h3>
                        <p className="text-zinc-400 text-sm mb-8 leading-relaxed">{error}</p>
                        <div className="flex flex-col gap-3">
                            {!forceProxy && (
                                <button
                                    onClick={() => { setError(null); setUseProxy(!useProxy); }}
                                    className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all border border-white/5"
                                >
                                    Toggle Proxy ({shouldProxy ? 'OFF' : 'ON'}) & Retry
                                </button>
                            )}
                            <button
                                onClick={() => window.location.reload()}
                                className="text-zinc-500 hover:text-white transition-colors text-sm"
                            >
                                Refresh Application
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Buffering Indicator */}
            {isBuffering && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] z-10 transition-all pointer-events-none">
                    <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                            <div className="w-12 h-12 border-2 border-blue-500/10 rounded-full"></div>
                            <div className="absolute inset-0 w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                        <p className="text-white text-[9px] uppercase font-bold tracking-[0.3em] opacity-50">Buffering</p>
                    </div>
                </div>
            )}

            {/* Initial Mute Overlay */}
            {/* Only show if currently muted AND it was auto-muted AND overlay is active */}
            {isMuted && isAutoMuted && showAutoMuteOverlay && !isBuffering && !error && (
                <div
                    className="absolute inset-0 flex items-center justify-center cursor-pointer z-20 bg-black/20"
                    onClick={toggleMute}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="bg-blue-600/10 hover:bg-blue-600/20 backdrop-blur-2xl text-white px-10 py-5 rounded-3xl flex items-center gap-5 shadow-3xl border border-white/10 transition-all hover:scale-105 active:scale-95 group/mute"
                    >
                        <div className="bg-white text-black p-2.5 rounded-full group-hover/mute:scale-110 transition-transform shadow-lg">
                            <VolumeX className="w-5 h-5" />
                        </div>
                        <div className="text-left">
                            <p className="font-bold text-base tracking-tight leading-none mb-1">Unmute Stream</p>
                            <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-medium">Browser auto-muted</p>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Settings Panel */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md z-[60] flex items-center justify-center p-6"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            className="bg-zinc-900 border border-white/10 p-8 rounded-3xl w-full max-w-sm shadow-3xl"
                        >
                            <div className="flex justify-between items-center mb-8">
                                <h3 className="text-white font-bold text-lg flex items-center gap-3">
                                    <Settings className="w-5 h-5 text-blue-500" />
                                    Advanced Controls
                                </h3>
                                <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white transition-colors">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="space-y-6">
                                {/* Media Statistics */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                                        <MonitorPlay className="w-5 h-5 text-blue-500 mb-2" />
                                        <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold mb-1">Resolution</span>
                                        <span className="text-white text-sm font-black tracking-tight">{mediaStats.width && mediaStats.height ? `${mediaStats.width}x${mediaStats.height}` : 'Unknown'}</span>
                                    </div>
                                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                                        <Activity className={clsx("w-5 h-5 mb-2", mediaStats.hasAudio === true ? "text-green-500" : (mediaStats.hasAudio === false ? "text-red-500" : "text-yellow-500"))} />
                                        <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold mb-1">Audio Stream</span>
                                        <span className="text-white text-sm font-black tracking-tight">{mediaStats.hasAudio === true ? 'Active Layer' : (mediaStats.hasAudio === false ? 'Missing Track' : 'Detecting...')}</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                                    <div className="flex flex-col">
                                        <span className="text-white text-sm font-bold flex items-center gap-2">
                                            {shouldProxy ? <Shield className="w-3 h-3 text-green-500" /> : <ShieldOff className="w-3 h-3 text-red-500" />}
                                            Backend Proxy
                                        </span>
                                        <span className="text-zinc-500 text-[11px] mt-1 leading-snug">{forceProxy ? 'Browser-hosted mode keeps proxy enabled to avoid leaking provider URLs.' : 'Reroutes stream to fix CORS. Disable for max speed.'}</span>
                                    </div>
                                    <button
                                        onClick={() => !forceProxy && setUseProxy(!useProxy)}
                                        disabled={forceProxy}
                                        className={clsx("w-12 h-6 rounded-full transition-all relative p-1", shouldProxy ? "bg-blue-600 shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)]" : "bg-zinc-700", forceProxy && "opacity-60 cursor-not-allowed")}
                                    >
                                        <div className={clsx("w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-md", shouldProxy ? "translate-x-6" : "translate-x-0")} />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                                    <div className="flex flex-col">
                                        <span className="text-white text-sm font-bold flex items-center gap-2">
                                            <Zap className={clsx("w-3 h-3", isStable ? "text-green-500" : "text-yellow-500")} />
                                            Stable Buffer
                                        </span>
                                        <span className="text-zinc-400 text-[11px] mt-1 leading-snug">Reduces stuttering. Disable for real-time.</span>
                                    </div>
                                    <button
                                        onClick={() => setIsStable(!isStable)}
                                        className={clsx("w-12 h-6 rounded-full transition-all relative p-1", isStable ? "bg-green-600 shadow-[0_0_15px_-3px_rgba(22,163,74,0.4)]" : "bg-zinc-700")}
                                    >
                                        <div className={clsx("w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-md", isStable ? "translate-x-6" : "translate-x-0")} />
                                    </button>
                                </div>

                                {allowDirectPlayback && directSourceUrl && (
                                    <button
                                        onClick={handleCopyUrl}
                                        className="w-full flex items-center justify-between p-4 bg-white/[0.02] hover:bg-white/5 rounded-2xl border border-white/5 transition-all text-left group"
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-white text-sm font-bold flex items-center gap-2">
                                                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-blue-500" />}
                                                {copied ? 'Copied to Clipboard' : 'Copy Stream Link'}
                                            </span>
                                            <span className="text-zinc-500 text-[11px] mt-1 leading-snug">Copy original URL for external players (VLC).</span>
                                        </div>
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={() => setShowSettings(false)}
                                className="w-full mt-10 bg-white text-black hover:bg-zinc-200 font-bold py-4 rounded-2xl transition-all shadow-xl active:scale-[0.98]"
                            >
                                Done
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* On-Screen Controls */}
            <div className={`absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-zinc-1000/90 via-zinc-950/60 to-transparent transition-opacity duration-300 z-[50] ${showSettings ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>

                {/* Progress Scrubber (VOD Only) */}
                {vodMode && (
                    <div className="mb-4 flex items-center gap-3">
                        <span className="text-xs font-mono text-zinc-400 min-w-[50px] text-right">{formatTime(currentTime)}</span>

                        <div className="relative flex-1 h-8 flex items-center group/scrubber">
                            {/* Background Track */}
                            <div className="absolute inset-x-0 h-1 bg-white/20 rounded-full overflow-hidden">
                                {/* Buffered Progress (Approximation) */}
                                <div className="h-full bg-white/30 w-full origin-left scale-x-0 transition-transform" />
                                {/* Play Progress */}
                                <div
                                    className="h-full bg-blue-500 rounded-full"
                                    style={{ width: `${(currentTime / duration) * 100}%` }}
                                />
                            </div>

                            {/* Interactive Input */}
                            <input
                                type="range"
                                min="0"
                                max={duration || 100}
                                value={currentTime}
                                onInput={(e) => setCurrentTime(parseFloat(e.target.value))}
                                onMouseDown={handleScrubStart}
                                onMouseUp={handleScrubEnd}
                                onChange={handleSeek}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                            />

                            {/* Thumb (Visual) */}
                            <div
                                className="absolute h-3 w-3 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover/scrubber:scale-125"
                                style={{ left: `${(currentTime / duration) * 100}%`, marginLeft: '-6px' }}
                            />
                        </div>

                        <span className="text-xs font-mono text-zinc-400 min-w-[50px]">{formatTime(duration)}</span>
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Play/Pause */}
                        <button
                            onClick={togglePlay}
                            className="text-white bg-blue-600/20 hover:bg-blue-600/40 p-3 rounded-2xl transition-all border border-blue-500/20 shadow-lg active:scale-90"
                        >
                            {!isPlaying ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
                        </button>

                        {/* Volume Control */}
                        <div className="flex items-center group/volume bg-white/5 hover:bg-white/10 rounded-2xl backdrop-blur-xl transition-all border border-white/10 pr-2">
                            <button
                                onClick={toggleMute}
                                className="text-white p-3 transition-all active:scale-90"
                            >
                                {isMuted || volume === 0 ? (
                                    <VolumeX className="w-5 h-5 text-red-500/60" />
                                ) : volume < 0.5 ? (
                                    <Volume2 className="w-5 h-5 text-zinc-400" />
                                ) : (
                                    <Volume2 className="w-5 h-5 text-blue-500" />
                                )}
                            </button>

                            <motion.div
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: "auto", opacity: 1 }}
                                className="overflow-hidden flex items-center"
                            >
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all mr-2"
                                />
                            </motion.div>
                        </div>

                        {/* Settings toggle */}
                        <button
                            onClick={() => setShowSettings(true)}
                            className="text-white bg-white/5 hover:bg-white/10 p-3 rounded-2xl backdrop-blur-xl transition-all border border-white/10 active:scale-90"
                            title="Advanced Controls"
                        >
                            <Settings className="w-5 h-5 opacity-60" />
                        </button>

                        {/* Fullscreen toggle */}
                        <button
                            onClick={toggleFullscreen}
                            className="text-white bg-white/5 hover:bg-white/10 p-3 rounded-2xl backdrop-blur-xl transition-all border border-white/10 active:scale-90"
                            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                        >
                            <Maximize2 className={clsx("w-5 h-5 opacity-60", isFullscreen && "text-blue-400")} />
                        </button>

                        {/* Picture-in-Picture */}
                        {document.pictureInPictureEnabled && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (document.pictureInPictureElement) {
                                        document.exitPictureInPicture().catch(() => {});
                                    } else if (videoRef.current) {
                                        videoRef.current.requestPictureInPicture().catch(() => {});
                                    }
                                }}
                                className="text-white bg-white/5 hover:bg-white/10 p-3 rounded-2xl backdrop-blur-xl transition-all border border-white/10 active:scale-90"
                                title="Picture-in-Picture"
                            >
                                <PictureInPicture2 className="w-5 h-5 opacity-60" />
                            </button>
                        )}

                        {/* Cast Button */}
                        <button
                            onClick={handleCast}
                            className="text-white bg-white/5 hover:bg-white/10 p-3 rounded-2xl backdrop-blur-xl transition-all border border-white/10 active:scale-90"
                            title="Cast to Device"
                        >
                            <Cast className="w-5 h-5 opacity-60" />
                        </button>

                        {/* Jump to Live (Only for Live Streams) */}
                        {!isLive && !vodMode && (
                            <button
                                onClick={jumpToLive}
                                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-lg animate-pulse"
                            >
                                <FastForward className="w-4 h-4" />
                                GO TO LIVE
                            </button>
                        )}

                        <div className="flex flex-col ml-1">
                            <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest leading-none mb-1.5 flex items-center gap-2">
                                {isLive && !vodMode && <Radio className="w-2 h-2 text-red-500" />}
                                {vodMode ? 'On Demand' : (isLive ? 'Live Stream' : 'Time Shifted')}
                            </span>
                            <div className="flex items-center gap-2">
                                <span className={clsx("text-[9px] font-bold px-2 py-0.5 rounded leading-none border", shouldProxy ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-zinc-800 text-zinc-400 border-white/5")}>
                                    {shouldProxy ? 'PROXIED' : 'DIRECT'}
                                </span>
                                <span className={clsx("text-[9px] font-bold px-2 py-0.5 rounded leading-none border", isStable ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20")}>
                                    {isStable ? 'STABLE' : 'UNOPTIMIZED'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest leading-none mb-1.5">Buffer</span>
                            <span className="text-[11px] text-zinc-200 font-mono flex items-center gap-2">
                                <span className={clsx("w-1.5 h-1.5 rounded-full", isBuffering ? "bg-yellow-400 animate-pulse" : "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]")}></span>
                                {isBuffering ? 'FILLING' : 'HEALTHY'}
                            </span>
                        </div>
                        <div className="h-8 w-px bg-white/10 mx-1"></div>
                        <div className="flex flex-col">
                            <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest leading-none mb-1.5">Stream</span>
                            <span className="text-[11px] text-white font-bold leading-none tracking-tight">
                                {isTs ? 'MPEG-TS' : 'HLS'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VideoPlayer;
