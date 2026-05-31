import React, { useState } from 'react';
import type { GameState, User } from '../api';
import { Clock, Paintbrush, Shield, User as UserIcon, Copy, Check } from 'lucide-react';

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
  const [copied, setCopied] = useState(false);
  
  // Decide timer glow theme based on remaining seconds
  const getTimerColorClass = () => {
    if (gameState?.status !== 'DRAWING') return 'text-slate-500';
    if (timeRemaining > 30) return 'text-neon-green shadow-neon-green/10';
    if (timeRemaining > 15) return 'text-neon-blue shadow-neon-blue/10';
    return 'text-neon-pink animate-pulse-neon';
  };

  const handleCopyCode = () => {
    if (!gameState) return;
    navigator.clipboard.writeText(gameState.board_id.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getMaskedWord = () => {
    const word = gameState?.current_word;
    if (!word) return 'LOADING';
    
    if (isDrawer) return word.toUpperCase();
    
    const len = word.length;
    let revealedIndices = new Set<number>();
    
    // Reveal letters progressively based on time elapsed:
    // - Reveal 1st letter at 40s remaining
    // - Reveal middle letter at 25s remaining
    // - Reveal near-end letter at 12s remaining
    if (timeRemaining <= 40 && len > 2) {
      revealedIndices.add(0);
    }
    if (timeRemaining <= 25 && len > 5) {
      revealedIndices.add(Math.floor(len / 2));
    }
    if (timeRemaining <= 12 && len > 7) {
      revealedIndices.add(len - 2);
    }
    
    let result = '';
    for (let i = 0; i < len; i++) {
      const char = word[i];
      if (char === ' ' || char === '-') {
        result += char;
      } else if (revealedIndices.has(i)) {
        result += char.toUpperCase();
      } else {
        result += '_';
      }
    }
    return result;
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

      {/* 2. Room Invite Code Panel (shown when in waiting lobby status) */}
      {gameState?.status === 'WAITING' && (
        <div className="glass-panel p-5 rounded-xl flex flex-col gap-3 border border-neon-blue/30 bg-neon-blue/5 shadow-[0_0_15px_rgba(56,189,248,0.05)]">
          <span className="text-[10px] font-heading font-extrabold tracking-wider text-neon-blue uppercase">
            Share Invite Code
          </span>
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 bg-navy-darker border border-navy-border hover:border-neon-blue/30 rounded-lg flex items-center justify-center font-mono font-black text-lg text-white select-all py-2">
              #{gameState.board_id}
            </div>
            
            <button
              onClick={handleCopyCode}
              className="bg-neon-blue hover:bg-neon-blue/80 text-navy-darker px-3.5 rounded-lg flex items-center justify-center transition-all active:scale-95 cursor-pointer font-heading font-extrabold text-[10px] gap-1 shrink-0"
              title="Copy Invite Code"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  COPIED
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  COPY
                </>
              )}
            </button>
          </div>
          <p className="text-[9px] text-slate-400 font-sans leading-relaxed m-0 text-left">
            Give this Room ID number to other players. They can enter it in the **"Join Room by ID"** form on their dashboard to play with you!
          </p>
        </div>
      )}

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
              <span className="font-mono font-bold text-lg tracking-[0.25em] text-slate-300">
                {getMaskedWord()}
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
