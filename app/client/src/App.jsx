import { useEffect, useState } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/auth-context';
import { isServerlessMode } from './api/api';
import Login from './pages/Login';
import { Tv, Film, Settings as SettingsIcon, LogOut, Clapperboard, LayoutTemplate, User, Search } from 'lucide-react';
import clsx from 'clsx';

import LivePlayer from './pages/LivePlayer';
import VODLibrary from './pages/VODLibrary';
import Settings from './pages/Settings';
import TVGuide from './pages/TVGuide';
import Profile from './pages/Profile';
import Onboarding from './pages/Onboarding';
import GlobalSearch from './components/GlobalSearch';
import SplashLoadingScreen from './components/SplashLoadingScreen';
import Dashboard from './pages/Dashboard';

const FullscreenLoader = ({ message = "INITIALIZING..." }) => (
  <SplashLoadingScreen isVisible={true} message={message} />
);

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isConfigured, isLocked, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  
  // If the app is brand new OR in 'Locked' mode (providers but no profiles), go to onboarding
  if (!isConfigured || isLocked) return <Navigate to="/onboarding" />;
  
  if (!isAuthenticated) return <Navigate to="/login" />;
  return children;
};

const LoginRoute = ({ children }) => {
  const { isAuthenticated, isConfigured, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (!isConfigured) return <Navigate to="/onboarding" />;
  if (isAuthenticated) return <Navigate to="/" />;
  return children;
};

const DashboardLayout = ({ children }) => {
  const { logout, currentProvider } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navItems = [
    { icon: LayoutTemplate, label: 'Dashboard', path: '/' },
    { icon: Tv, label: 'Live TV', path: '/live' },
    { icon: LayoutTemplate, label: 'TV Guide', path: '/tv-guide' },
    { icon: Film, label: 'Movies', path: '/movies' },
    { icon: Clapperboard, label: 'Series', path: '/series' },
    { icon: SettingsIcon, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="flex h-screen bg-[#0a0f1c] text-white overflow-hidden">
      <div className="w-20 lg:w-64 flex flex-col border-r border-white/5 bg-black/20 backdrop-blur-xl">
        <div onClick={() => navigate('/')} className="h-20 flex items-center justify-center border-b border-white/5 cursor-pointer group relative">
          {/* Hamburger Icon for Mobile - User requested Image 2 */}
          <div className="lg:hidden w-8 h-8 relative group-hover:scale-110 transition-transform">
            <img 
              src="./hamburger.png" 
              alt="Menu" 
              className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_0_10px_rgba(45,212,191,0.5)]" 
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
            />
            {/* Fallback TV icon if hamburger image is completely missing */}
            <Tv className="w-full h-full text-teal-400 hidden" />
          </div>

          <Tv className="hidden lg:block w-8 h-8 text-teal-400 group-hover:scale-110 transition-transform" />
          <span className="hidden lg:block ml-3 font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-blue-400 to-purple-400 tracking-tight">M3 Prism</span>
        </div>

        <nav className="flex-1 py-8 space-y-2 px-3">
          <button onClick={() => setSearchOpen(true)} className="w-full flex items-center px-4 py-3 rounded-xl transition-all group text-gray-400 hover:bg-white/5 hover:text-white mb-2">
            <Search className="w-5 h-5 lg:mr-3 group-hover:scale-110 transition-transform" />
            <span className="hidden lg:flex items-center justify-between flex-1">
              <span className="font-medium">Search</span>
              <kbd className="text-[9px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded font-mono border border-zinc-700">Ctrl/Cmd+K</kbd>
            </span>
          </button>

          <div className="border-b border-white/5 mb-2" />
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => clsx(
                'flex items-center px-4 py-3 rounded-xl transition-all group',
                isActive
                  ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-white border border-white/5 shadow-glow-sm'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              )}
            >
              <item.icon className="w-5 h-5 lg:mr-3 group-hover:scale-110 transition-transform" />
              <span className="hidden lg:block font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div onClick={() => navigate('/profile')} className="flex items-center mb-4 px-2 cursor-pointer hover:bg-white/5 p-2 rounded-xl transition-colors group" title="View Profile">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="hidden lg:block ml-3 overflow-hidden">
              <p className="text-sm font-bold truncate text-white group-hover:text-blue-400 transition-colors">{currentProvider?.name || 'Guest'}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Active Session
              </p>
            </div>
          </div>
          <button onClick={logout} className="w-full flex items-center justify-center lg:justify-start px-4 py-3 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all group">
            <LogOut className="w-5 h-5 lg:mr-3 group-hover:-translate-x-1 transition-transform" />
            <span className="hidden lg:block text-sm font-black uppercase tracking-wider">Logout</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative bg-[#05080f]">{children}</div>
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
};

function App() {
  const Router = isServerlessMode() ? HashRouter : BrowserRouter;
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute><Login /></LoginRoute>} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <DashboardLayout>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/live" element={<LivePlayer />} />
                  <Route path="/tv-guide" element={<TVGuide />} />
                  <Route path="/movies" element={<VODLibrary type="movies" />} />
                  <Route path="/series" element={<VODLibrary type="series" />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/profile" element={<Profile />} />
                </Routes>
              </DashboardLayout>
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
