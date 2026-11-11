import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SplashLoadingScreen = ({ message = "LOADING...", isVisible = true, version = "1.1" }) => {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
                    className="fixed inset-0 z-[9999] bg-[#0f111a] flex flex-col items-center justify-center overflow-hidden"
                >
                    {/* Background Glows */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vh] h-[80vh] bg-teal-500/10 blur-[120px] rounded-full pointer-events-none" />
                    <div className="absolute top-[60%] left-[40%] w-[60vh] h-[60vh] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none" />

                    <div className="relative z-10 flex flex-col items-center max-w-md w-full px-8">
                        {/* Logo Container */}
                        <motion.div 
                            className="relative w-64 h-64 mb-12 flex items-center justify-center group"
                            animate={{ 
                                scale: [1, 1.05, 1],
                            }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        >
                            {/* Attempt to load provided user image, fallback to CSS recreation if missing */}
                            <img 
                                src="/icon.png" 
                                alt="M3 Prism Logo" 
                                className="absolute inset-0 w-full h-full object-contain z-20 drop-shadow-[0_0_30px_rgba(45,212,191,0.5)]"
                                onError={(e) => {
                                    // If image not found in public, hide img tag to show CSS fallback underneath
                                    e.target.style.opacity = '0';
                                }}
                            />

                            {/* CSS Fallback (similar structure to the image) */}
                            <div className="absolute inset-0 z-10 flex items-center justify-center opacity-80" style={{ backgroundImage: "url('/assets/icon.png')", backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat'}}>
                                {/* Outer rings */}
                                <div className="absolute inset-0 border-t-2 border-teal-400 rounded-full opacity-60 rotate-[30deg]" />
                                <div className="absolute inset-4 border-r-2 border-purple-500 rounded-full opacity-60 rotate-[-15deg]" />
                                <div className="absolute inset-8 border-b-2 border-blue-500 rounded-full opacity-60 rotate-[45deg]" />
                                {/* Inner Triangle */}
                                <div className="w-32 h-32 border-b-4 border-l-[32px] border-r-[32px] border-b-white border-l-transparent border-r-transparent drop-shadow-[0_0_20px_rgba(255,255,255,0.8)] filter opacity-90" />
                                {/* Nodes */}
                                <div className="absolute top-[5%] w-6 h-6 rounded-full bg-teal-300 shadow-[0_0_15px_#5eead4]" />
                                <div className="absolute bottom-[10%] left-[10%] w-6 h-6 rounded-full bg-blue-400 shadow-[0_0_15px_#60a5fa]" />
                                <div className="absolute bottom-[10%] right-[10%] w-6 h-6 rounded-full bg-purple-500 shadow-[0_0_15px_#a855f7]" />
                            </div>
                        </motion.div>

                        {/* Title Text */}
                        <motion.h1 
                            className="text-4xl font-black text-white tracking-widest mb-2"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                        >
                            M3 PRISM
                        </motion.h1>
                        <motion.p 
                            className="text-[10px] text-zinc-400 uppercase tracking-[0.3em] font-bold mb-12"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4 }}
                        >
                            Multi-Model Media Player
                        </motion.p>

                        {/* Loading Bar */}
                        <motion.div 
                            className="w-full flex flex-col items-center"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.6 }}
                        >
                            <span className="text-[10px] uppercase font-bold text-teal-400 tracking-widest mb-4">
                                {message}
                            </span>
                            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden relative">
                                <motion.div 
                                    className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-teal-400 via-blue-500 to-purple-500 rounded-full"
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                />
                            </div>
                        </motion.div>

                        {/* Version Badge */}
                        <div className="absolute bottom-8 right-8 flex flex-col items-center">
                            <div className="w-8 h-8 relative mb-1">
                                <img 
                                    src="/icon.png" 
                                    alt="logo" 
                                    className="w-full h-full object-contain opacity-50 grayscale hover:grayscale-0 transition-all"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            </div>
                            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">v.{version}</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SplashLoadingScreen;
