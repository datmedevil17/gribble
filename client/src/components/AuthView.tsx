import React, { useState } from 'react';
import { api, setAuthToken, setActiveUser } from '../api';
import { User, Lock, Mail, AlertTriangle } from 'lucide-react';
import Iridescence from './Iridescence';

interface AuthViewProps {
  onAuthSuccess: () => void;
}

const BG_COLOR: [number, number, number] = [0.35, 0.2, 0.65];

export const AuthView: React.FC<AuthViewProps> = ({ onAuthSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        // Register flow
        await api.register(username, email, password);
        // Automatically log in after registration
        const loginData = await api.login(email, password);
        setAuthToken(loginData.token);
        setActiveUser({
          id: loginData.user_id,
          username: loginData.username,
          email: loginData.email,
        });
      } else {
        // Login flow
        const loginData = await api.login(email, password);
        setAuthToken(loginData.token);
        setActiveUser({
          id: loginData.user_id,
          username: loginData.username,
          email: loginData.email,
        });
      }
      onAuthSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden px-4">
      {/* WebGL Iridescence background overlay */}
      <div className="absolute inset-0 z-0 opacity-45">
        <Iridescence color={BG_COLOR} speed={0.45} amplitude={0.08} />
      </div>

      {/* Dynamic visual aura background */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-purple/5 rounded-full filter blur-[100px] pointer-events-none z-1"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-blue/5 rounded-full filter blur-[100px] pointer-events-none z-1"></div>

      <div className="glass-panel-neon w-full max-w-md p-8 rounded-2xl relative z-10">
        {/* Brand Logo Header */}
        <div className="text-center mb-8">
          <h1 className="font-heading font-extrabold text-4xl tracking-tight text-white m-0">
            Scribbble<span className="text-neon-purple animate-pulse">.</span>
          </h1>
          <p className="text-slate-400 font-sans text-sm mt-2">
            {isRegister
              ? 'Join the ultimate real-time multiplayer drawing arena'
              : 'Sign in to draw, guess, and dominate the lobby'}
          </p>
        </div>

        {/* Error Alert Box */}
        {error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 mb-6 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
            <p className="m-0 font-sans font-medium">{error}</p>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {isRegister && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-heading font-semibold tracking-wider text-slate-400 uppercase">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter a unique name"
                  className="w-full bg-navy-darker border border-navy-border focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none rounded-lg pl-10 pr-4 py-3 text-sm text-slate-200 transition-all font-sans"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-heading font-semibold tracking-wider text-slate-400 uppercase">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full bg-navy-darker border border-navy-border focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none rounded-lg pl-10 pr-4 py-3 text-sm text-slate-200 transition-all font-sans"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-heading font-semibold tracking-wider text-slate-400 uppercase">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-navy-darker border border-navy-border focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none rounded-lg pl-10 pr-4 py-3 text-sm text-slate-200 transition-all font-sans"
              />
            </div>
          </div>

          {/* Submit CTA */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-neon-purple to-neon-blue text-navy-darker font-heading font-bold text-sm tracking-wide py-3.5 rounded-lg hover:shadow-[0_0_20px_rgba(192,132,252,0.3)] hover:brightness-110 active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase"
          >
            {loading
              ? 'Verifying...'
              : isRegister
              ? 'Create Secure Account'
              : 'Enter Lobby'}
          </button>
        </form>

        {/* Bottom Panel Toggle */}
        <div className="text-center mt-6">
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs font-sans text-slate-400 hover:text-neon-purple transition-colors cursor-pointer"
          >
            {isRegister
              ? 'Already have an account? Sign in here'
              : "Don't have an account? Sign up here"}
          </button>
        </div>
      </div>
    </div>
  );
};
export default AuthView;
