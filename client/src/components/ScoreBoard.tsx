import React from 'react';
import { GameState, User } from '../api';
import { Award, Clock, Paintbrush, Shield, User as UserIcon } from 'lucide-react';

interface ScoreBoardProps {
  gameState: GameState | null;
  activeUsers: User[];
  currentUserID: number;
}

export const ScoreBoard: React.FC<ScoreBoardProps> = ({
  gameState,
  activeUsers,
  currentUserID,
}) => {
  const isDrawer = gameState?.drawer_id === currentUserID;
  const timeRemaining = gameState?.time_remaining ?? 60;
  
  // Decide timer glow theme based on remaining seconds
  const getTimerColorClass = () => {
    if (gameState?.status !== 'DRAWING') return 'text-slate-500';
    if (timeRemaining > 30) return 'text-neon-green shadow-neon-green/10';
    if (timeRemaining > 15) return 'text-neon-blue shadow-neon-blue/10';
    return 'text-neon-pink animate-pulse-neon';
  };

  return (
    <div className="flex flex-col gap-6 w-full md:w-64 shrink-0">
      
      {/* 1. Ticking Countdown Timer */}
      <div className="glass-panel p-5 rounded-xl flex items-center justify-between gap-4 border border-navy-border/80">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-400" />
          <span className="text-xs font-heading font-extrabold tracking-wider text-slate-400 uppercase">
            Turn Clock
          </span>
        </div>
        <div className={`font-mono text-3xl font-extrabold tracking-tight ${getTimerColorClass()}`}>
          {gameState?.status === 'DRAWING' ? `${timeRemaining}s` : 'Waiting'}
        </div>
      </div>

      {/* 2. Secret Word Indicator Box */}
      {gameState?.status === 'DRAWING' && (
        <div className="glass-panel p-5 rounded-xl flex flex-col gap-2.5 border border-navy-border/80">
          <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase">
            {isDrawer ? 'Your Secret Word' : 'Current Word Hint'}
          </span>
          <div className="bg-navy-darker px-4 py-3 rounded-lg border border-navy-border text-center">
            {isDrawer ? (
              <span className="font-heading font-extrabold text-base text-neon-purple tracking-wide uppercase">
                {gameState.current_word}
              </span>
            ) : (
              // Mask the letters for spectating guessers
              <span className="font-mono font-bold text-lg tracking-[0.25em] text-slate-300">
                {gameState.current_word
                  ? gameState.current_word.replace(/[a-zA-Z]/g, '_')
                  : 'LOADING'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 3. Players list */}
      <div className="glass-panel p-5 rounded-xl flex flex-col gap-4 border border-navy-border/80 flex-1">
        <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase">
          Player Standings
        </span>

        <div className="flex flex-col gap-3 max-h-[300px] md:max-h-none overflow-y-auto pr-1">
          {activeUsers.map((user) => {
            const isPlayerDrawer = gameState?.drawer_id === user.id;
            const playerScore = gameState?.scores?.[user.id]?.score ?? 0;
            const isSelf = user.id === currentUserID;

            return (
              <div
                key={user.id}
                className={`flex items-center justify-between p-3.5 rounded-lg border transition-all ${
                  isSelf
                    ? 'bg-neon-purple/5 border-neon-purple/30'
                    : 'bg-navy-darker border-navy-border hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Icon badge based on status */}
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                    isPlayerDrawer 
                      ? 'bg-neon-purple/20 text-neon-purple animate-pulse-neon' 
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {isPlayerDrawer ? (
                      <Paintbrush className="w-4 h-4" />
                    ) : isSelf ? (
                      <Shield className="w-4 h-4 text-neon-purple" />
                    ) : (
                      <UserIcon className="w-4 h-4" />
                    )}
                  </div>
                  
                  {/* Name tags */}
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm font-heading font-bold truncate ${
                      isSelf ? 'text-neon-purple' : 'text-slate-200'
                    }`}>
                      {user.username}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 uppercase">
                      ID #{user.id}
                    </span>
                  </div>
                </div>

                {/* Score Points */}
                <div className="flex flex-col items-end">
                  <span className="font-mono text-xs font-extrabold text-neon-blue">
                    {playerScore}
                  </span>
                  <span className="text-[8px] font-heading tracking-widest text-slate-500 font-bold uppercase mt-0.5">
                    PTS
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
export default ScoreBoard;
