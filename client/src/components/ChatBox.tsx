import React, { useState, useRef, useEffect } from 'react';

export interface ChatMessage {
  id: string;
  user_id: number;
  username: string;
  text: string;
  is_system: boolean;
  is_correct: boolean;
}

interface ChatBoxProps {
  wsConn: WebSocket | null;
  chatMessages: ChatMessage[];
  isDrawer: boolean;
}

export const ChatBox: React.FC<ChatBoxProps> = ({ wsConn, chatMessages, isDrawer }) => {
  const [guess, setGuess] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll lock to keep chat locked at the bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleSendGuess = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guess.trim() || !wsConn || wsConn.readyState !== WebSocket.OPEN) return;

    const payload = {
      type: 'chat',
      text: guess.trim(),
    };

    // Emit the guess down the WebSocket pipe
    wsConn.send(JSON.stringify(payload));
    setGuess('');
  };

  return (
    <div className="glass-panel p-5 rounded-xl flex flex-col h-[400px] md:h-auto border border-navy-border/80 flex-1 shadow-lg">
      <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase mb-4">
        Game Chat & Guesses
      </span>

      {/* 1. Scrollable Chat Message Feed */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1 mb-4 font-sans text-xs">
        {chatMessages.length === 0 ? (
          <div className="text-slate-500 text-center my-auto italic">
            Quiet room. Type a message or submit a guess!
          </div>
        ) : (
          chatMessages.map((msg) => {
            if (msg.is_system) {
              return (
                <div
                  key={msg.id}
                  className={`px-3 py-2 rounded-lg border text-center font-semibold tracking-wide ${
                    msg.is_correct
                      ? 'bg-neon-green/10 border-neon-green/30 text-neon-green animate-pulse-neon'
                      : 'bg-navy-dark border-navy-border text-slate-400'
                  }`}
                >
                  {msg.text}
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className="bg-navy-darker/60 border border-navy-border/40 p-2.5 rounded-lg flex flex-col gap-0.5"
              >
                <div className="flex justify-between items-center">
                  <span className="font-heading font-bold text-slate-300">
                    {msg.username}
                  </span>
                  <span className="text-[8px] font-mono text-slate-600 uppercase">
                    ID #{msg.user_id}
                  </span>
                </div>
                <p className="m-0 text-slate-400 font-sans leading-relaxed text-left break-all">
                  {msg.text}
                </p>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 2. Guess Submission Form */}
      <form onSubmit={handleSendGuess} className="flex gap-2">
        <input
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          disabled={isDrawer}
          placeholder={
            isDrawer
              ? 'Drawers cannot submit guesses!'
              : 'Type your guess here...'
          }
          className="flex-1 bg-navy-darker border border-navy-border focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none rounded-lg px-3.5 py-2.5 text-xs text-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed font-sans"
        />
        
        <button
          type="submit"
          disabled={isDrawer || !guess.trim()}
          className="bg-gradient-to-r from-neon-purple to-neon-blue text-navy-darker font-heading font-extrabold text-[10px] tracking-widest px-5 rounded-lg hover:shadow-[0_0_15px_rgba(192,132,252,0.3)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed uppercase"
        >
          SUBMIT
        </button>
      </form>
    </div>
  );
};
export default ChatBox;
