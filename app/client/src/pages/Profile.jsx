import { useState } from 'react';
import { useAuth } from '../context/auth-context';
import { User, Shield, Calendar, Activity, LogOut, Key, Globe, CreditCard } from 'lucide-react';

const COLOR_STYLES = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    purple: 'bg-purple-500/10 text-purple-400',
    orange: 'bg-orange-500/10 text-orange-400',
    pink: 'bg-pink-500/10 text-pink-400',
    indigo: 'bg-indigo-500/10 text-indigo-400',
    red: 'bg-red-500/10 text-red-400',
};

const InfoCard = ({ icon: Icon, label, value, color = 'blue' }) => (
    <div className="bg-white/5 border border-white/5 p-6 rounded-3xl group hover:bg-white/[0.08] transition-all duration-300">
        <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl group-hover:scale-110 transition-transform duration-300 ${COLOR_STYLES[color]}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">{label}</p>
                <p className="text-lg font-bold text-white truncate">{value || 'N/A'}</p>
            </div>
        </div>
    </div>
);

const Profile = () => {
    const { user, currentProvider, logout } = useAuth();
    const [mountedAt] = useState(() => Date.now() / 1000);

    if (!user) {
        return null;
    }

    const formatDate = (timestamp) => {
        if (!timestamp || timestamp === '0') return 'Never';
        const date = new Date(timestamp * 1000);
        if (Number.isNaN(date.getTime())) return timestamp;
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const isExpired = user.status === 'Expired' || (user.exp_date && user.exp_date < mountedAt);
    const providerProtocol = currentProvider?.type === 'm3u' ? 'M3U Playlist' : 'Xtream Codes';

    return (
        <div className="p-8 max-w-6xl mx-auto h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12">
                <div className="flex items-center gap-6">
                    <div className="relative">
                        <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-2xl">
                            <User className="w-12 h-12 text-white" />
                        </div>
                        <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-full text-[10px] font-black uppercase border-4 border-[#05080f] shadow-lg ${isExpired ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
                            {user.status || (isExpired ? 'Expired' : 'Active')}
                        </div>
                    </div>
                    <div>
                        <h1 className="text-4xl font-black text-white tracking-tight mb-2">Account Overview</h1>
                        <p className="text-gray-400 flex items-center gap-2">
                            <Globe className="w-4 h-4 text-blue-500" />
                            Connected to <span className="text-blue-400 font-bold">{currentProvider?.name}</span>
                        </p>
                    </div>
                </div>

                <button
                    onClick={logout}
                    className="flex items-center gap-3 px-8 py-4 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white font-bold rounded-2xl transition-all duration-300 border border-red-500/20 shadow-lg group"
                >
                    <LogOut className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    Sign Out
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                <InfoCard icon={User} label="Username" value={user.username} color="blue" />
                <InfoCard icon={Shield} label="Account Status" value={user.status || 'Active'} color={isExpired ? 'red' : 'green'} />
                <InfoCard icon={Calendar} label="Expiry Date" value={formatDate(user.exp_date)} color="purple" />
                <InfoCard icon={Activity} label="Active Connections" value={`${user.active_cons || 0} / ${user.max_connections || 1}`} color="orange" />
                <InfoCard icon={CreditCard} label="Trial Account" value={user.is_trial === '1' ? 'Yes' : 'No'} color="pink" />
                <InfoCard icon={Key} label="Auth Level" value={String(user.auth) === '1' || user.auth === 1 ? 'Authenticated' : 'Guest'} color="indigo" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white/5 border border-white/5 p-8 rounded-[2.5rem]">
                    <h3 className="text-xl font-black text-white mb-6 flex items-center gap-3">
                        <Globe className="w-6 h-6 text-blue-500" />
                        Provider Metadata
                    </h3>
                    <div className="space-y-4">
                        <div className="flex justify-between py-3 border-b border-white/5">
                            <span className="text-gray-500 text-sm font-bold uppercase tracking-widest">Provider ID</span>
                            <span className="text-white font-mono text-sm">{currentProvider?.id}</span>
                        </div>
                        <div className="flex justify-between py-3 border-b border-white/5">
                            <span className="text-gray-500 text-sm font-bold uppercase tracking-widest">Server URL</span>
                            <span className="text-white font-mono text-sm opacity-50">{currentProvider?.url || 'Stored internally'}</span>
                        </div>
                        <div className="flex justify-between py-3">
                            <span className="text-gray-500 text-sm font-bold uppercase tracking-widest">Protocol</span>
                            <span className="text-blue-400 font-bold text-sm">{providerProtocol}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/20 p-8 rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/20 blur-[80px] group-hover:bg-blue-500/40 transition-all duration-700" />
                    <h3 className="text-xl font-black text-white mb-6">Service Notice</h3>
                    <p className="text-gray-300 leading-relaxed mb-6">
                        Subscription details come from the active provider when available. Playlist-only profiles keep a local application session instead.
                    </p>
                    <div className="flex items-center gap-4 text-xs font-black uppercase tracking-tighter text-blue-400 bg-blue-400/10 p-4 rounded-2xl border border-blue-400/20">
                        <Shield className="w-4 h-4" />
                        Secure Session Active
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
