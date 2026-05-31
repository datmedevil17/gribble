import React, { useRef, useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { GameState } from '../api';
import { Settings, Play, ChevronDown } from 'lucide-react';

export interface Point {
  x: number;
  y: number;
}

export interface StrokePayload {
  id?: string;
  board_id: number;
  user_id: number;
  points: Point[];
  color: string;
  line_width: number;
  is_eraser: boolean;
}

interface CursorPosition {
  x: number;
  y: number;
  username: string;
}

interface DrawingCanvasProps {
  boardID: number;
  userID: number;
  wsConn: WebSocket | null;
  isDrawer: boolean;
  isOwner: boolean;
  strokeColor: string;
  strokeWidth: number;
  isEraser: boolean;
  gameState: GameState | null;
  currentUserOwnerID: number;
  drawerCursor: CursorPosition | null;
}

// Room configuration option sets
const DRAWTIME_OPTIONS = [30, 45, 60, 80, 100, 120, 150, 180];
const ROUNDS_OPTIONS = [2, 3, 4, 5, 6, 8, 10];
const HINTS_OPTIONS = [0, 1, 2, 3, 4, 5];
const WORDCOUNT_OPTIONS = [1, 2, 3, 4, 5];
const LANGUAGE_OPTIONS = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian'];
const GAMEMODE_OPTIONS = ['Normal', 'Hidden Word', 'Fast Mode'];

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  boardID,
  userID,
  wsConn,
  isDrawer,
  isOwner,
  strokeColor,
  strokeWidth,
  isEraser,
  gameState,
  currentUserOwnerID,
  drawerCursor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const pointBuffer = useRef<Point[]>([]);
  const lastPos = useRef<Point>({ x: 0, y: 0 });

  // Room config local state (mirrors game state for immediate UI feedback)
  const [roomConfig, setRoomConfig] = useState({
    max_rounds: gameState?.max_rounds ?? 4,
    draw_time: gameState?.draw_time ?? 80,
    hints: gameState?.hints ?? 3,
    language: gameState?.language ?? 'English',
    game_mode: gameState?.game_mode ?? 'Normal',
    word_count: gameState?.word_count ?? 3,
    custom_words: gameState?.custom_words ?? '',
    custom_words_only: gameState?.custom_words_only ?? false,
  });

  // Sync local config when game state changes from server
  useEffect(() => {
    if (gameState?.status === 'WAITING') {
      setRoomConfig({
        max_rounds: gameState?.max_rounds ?? 4,
        draw_time: gameState?.draw_time ?? 80,
        hints: gameState?.hints ?? 3,
        language: gameState?.language ?? 'English',
        game_mode: gameState?.game_mode ?? 'Normal',
        word_count: gameState?.word_count ?? 3,
        custom_words: gameState?.custom_words ?? '',
        custom_words_only: gameState?.custom_words_only ?? false,
      });
    }
  }, [gameState?.status]);

  // Broadcast config change over WebSocket (debounced on blur)
  const sendConfigUpdate = useCallback((cfg: typeof roomConfig) => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    wsConn.send(JSON.stringify({ type: 'configure_room', ...cfg }));
  }, [wsConn]);

  const handleConfigChange = (key: keyof typeof roomConfig, value: any) => {
    const newCfg = { ...roomConfig, [key]: value };
    setRoomConfig(newCfg);
    sendConfigUpdate(newCfg);
  };

  const handleStartGame = () => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    wsConn.send(JSON.stringify({ type: 'start_game' }));
  };

  const handleSelectWord = (word: string) => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    wsConn.send(JSON.stringify({ type: 'select_word', word }));
  };

  // Get canvas coordinates normalized to internal 1000x700 grid
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return lastPos.current;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const drawLine = (
    ctx: CanvasRenderingContext2D,
    p1: Point,
    p2: Point,
    color: string,
    width: number,
    eraser: boolean
  ) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  // Flush buffered points over WebSocket (chunked streaming every 4 points)
  const flushBuffer = useCallback((force = false) => {
    const buf = pointBuffer.current;
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    if (!force && buf.length < 4) return;
    if (buf.length === 0) return;

    const payload: StrokePayload = {
      board_id: boardID,
      user_id: userID,
      points: [...buf],
      color: isEraser ? 'rgba(0,0,0,1)' : strokeColor,
      line_width: strokeWidth,
      is_eraser: isEraser,
    };
    wsConn.send(JSON.stringify(payload));

    // Keep last point as continuation anchor for smooth joins
    pointBuffer.current = buf.length > 0 ? [buf[buf.length - 1]] : [];
  }, [wsConn, boardID, userID, strokeColor, strokeWidth, isEraser]);

  // Send cursor position for spectators to track the drawer
  const sendCursorMove = useCallback((pos: Point) => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    wsConn.send(JSON.stringify({
      type: 'cursor_move',
      x: pos.x,
      y: pos.y,
    }));
  }, [wsConn]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawer) return;
    isDrawing.current = true;
    const pos = getCoordinates(e);
    lastPos.current = pos;
    pointBuffer.current = [pos];
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawer) return;
    const pos = getCoordinates(e);

    // Always stream cursor position even when not pressing
    sendCursorMove(pos);

    if (!isDrawing.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render locally for immediate feedback
    drawLine(ctx, lastPos.current, pos, isEraser ? '#ffffff' : strokeColor, strokeWidth, isEraser);
    lastPos.current = pos;
    pointBuffer.current.push(pos);

    // Stream chunk when buffer hits threshold
    flushBuffer(false);
  };

  const stopDrawing = () => {
    if (!isDrawing.current || !isDrawer) return;
    isDrawing.current = false;
    // Flush remaining points
    flushBuffer(true);
    pointBuffer.current = [];
  };

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 1000;
    canvas.height = 700;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // Compute cursor overlay position (normalized canvas → CSS pixels)
  const getCursorStyle = (): React.CSSProperties | null => {
    if (!drawerCursor || !containerRef.current) return null;
    const container = containerRef.current;
    const scaleX = container.clientWidth / 1000;
    const scaleY = container.clientHeight / 700;
    return {
      left: `${drawerCursor.x * scaleX}px`,
      top: `${drawerCursor.y * scaleY}px`,
    };
  };

  const cursorStyle = getCursorStyle();

  const getWinner = () => {
    if (!gameState || !gameState.scores) return { name: 'Nobody', score: 0 };
    let winnerName = 'Nobody';
    let highestScore = -1;
    Object.values(gameState.scores).forEach((scoreObj) => {
      if (scoreObj.score > highestScore) {
        highestScore = scoreObj.score;
        winnerName = scoreObj.username;
      }
    });
    return { name: winnerName, score: highestScore };
  };

  const winner = getWinner();
  const isCanvasOwner = currentUserOwnerID === userID;
  const maxRounds = roomConfig.max_rounds ?? 4;

  // ─── Guest Waiting Screen (WAITING, non-owner) ──────────────────────────
  if (gameState?.status === 'WAITING' && !isOwner) {
    return (
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-navy-border/80 shadow-2xl glass-panel flex flex-col items-center justify-center p-8 text-center select-none">
        {/* Animated background glows */}
        <div className="absolute -top-20 -left-20 w-72 h-72 bg-neon-purple/5 rounded-full filter blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-20 -right-20 w-72 h-72 bg-neon-blue/5 rounded-full filter blur-3xl pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />

        {/* Pulsing logo */}
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 border border-neon-purple/30 flex items-center justify-center text-4xl shadow-[0_0_30px_rgba(192,132,252,0.15)]">
            🎨
          </div>
          {/* Orbit dots */}
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-neon-purple rounded-full animate-ping" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-neon-purple rounded-full" />
        </div>

        <h2 className="font-heading font-black text-xl text-white mb-2">
          Waiting for Host
        </h2>
        <p className="text-xs text-slate-400 font-sans leading-relaxed max-w-xs">
          The host is setting up the room. The game will start soon!
        </p>

        {/* Animated dots */}
        <div className="flex items-center gap-1.5 mt-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-neon-purple/60"
              style={{
                animation: 'pulse 1.4s ease-in-out infinite',
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>

        <div className="mt-8 text-[10px] font-heading text-slate-600 uppercase tracking-widest">
          Get ready to guess! ✏️
        </div>
      </div>
    );
  }

  // ─── Host Config Panel (WAITING, owner) ──────────────────────────────────
  if (gameState?.status === 'WAITING' && isOwner) {
    return (
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-navy-border/80 shadow-2xl glass-panel flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 pt-5 pb-3 border-b border-navy-border/60">
          <Settings className="w-4 h-4 text-neon-purple" />
          <span className="font-heading font-extrabold text-sm text-white tracking-wider uppercase">Room Settings</span>
          <span className="ml-auto text-[9px] font-heading font-bold text-neon-green uppercase tracking-widest bg-neon-green/10 border border-neon-green/20 px-2 py-0.5 rounded">
            HOST 👑
          </span>
        </div>

        {/* Config Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-2 gap-4">
          <ConfigRow label="🌐 Language" icon="">
            <ConfigSelect
              value={roomConfig.language}
              options={LANGUAGE_OPTIONS}
              onChange={(v) => handleConfigChange('language', v)}
            />
          </ConfigRow>

          <ConfigRow label="⏱️ Draw Time" icon="">
            <ConfigSelect
              value={roomConfig.draw_time}
              options={DRAWTIME_OPTIONS}
              onChange={(v) => handleConfigChange('draw_time', Number(v))}
              formatLabel={(v) => `${v}s`}
            />
          </ConfigRow>

          <ConfigRow label="🔄 Rounds" icon="">
            <ConfigSelect
              value={roomConfig.max_rounds}
              options={ROUNDS_OPTIONS}
              onChange={(v) => handleConfigChange('max_rounds', Number(v))}
            />
          </ConfigRow>

          <ConfigRow label="🎯 Game Mode" icon="">
            <ConfigSelect
              value={roomConfig.game_mode}
              options={GAMEMODE_OPTIONS}
              onChange={(v) => handleConfigChange('game_mode', v)}
            />
          </ConfigRow>

          <ConfigRow label="📝 Word Count" icon="">
            <ConfigSelect
              value={roomConfig.word_count}
              options={WORDCOUNT_OPTIONS}
              onChange={(v) => handleConfigChange('word_count', Number(v))}
            />
          </ConfigRow>

          <ConfigRow label="💡 Hints" icon="">
            <ConfigSelect
              value={roomConfig.hints}
              options={HINTS_OPTIONS}
              onChange={(v) => handleConfigChange('hints', Number(v))}
            />
          </ConfigRow>
        </div>

        {/* Custom Words Section */}
        <div className="px-6 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-heading font-bold text-slate-400 uppercase tracking-wider">
              ✏️ Custom Words
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[9px] font-heading text-slate-500 uppercase tracking-wider">Custom only</span>
              <input
                type="checkbox"
                checked={roomConfig.custom_words_only}
                onChange={(e) => handleConfigChange('custom_words_only', e.target.checked)}
                className="w-3 h-3 accent-neon-purple"
              />
            </label>
          </div>
          <textarea
            value={roomConfig.custom_words}
            onChange={(e) => handleConfigChange('custom_words', e.target.value)}
            placeholder="comma-separated • e.g.: rocket, dragon, pizza"
            className="w-full h-12 bg-navy-darker border border-navy-border focus:border-neon-purple outline-none rounded-lg px-3 py-2 text-[11px] text-slate-300 font-sans resize-none transition-colors"
          />
        </div>

        {/* Start Button */}
        <div className="px-6 pb-5">
          <button
            onClick={handleStartGame}
            className="w-full bg-gradient-to-r from-neon-green/80 to-neon-blue text-navy-darker font-heading font-extrabold text-sm tracking-widest py-3.5 rounded-xl hover:brightness-110 hover:shadow-[0_0_25px_rgba(74,222,128,0.4)] active:scale-[0.98] transition-all cursor-pointer uppercase flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            🏁 START GAME!
          </button>
        </div>
      </div>
    );
  }

  // ─── Word Selection Overlay (SELECTING_WORD) ─────────────────────────────
  if (gameState?.status === 'SELECTING_WORD') {
    const isActiveDrawer = gameState?.drawer_id === userID;
    const timeLeft = gameState?.time_remaining ?? 15;
    const timerPct = Math.max(0, (timeLeft / 15) * 100);

    return (
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-navy-border/80 shadow-2xl glass-panel flex flex-col items-center justify-center p-8 text-center select-none">
        {/* Background glow */}
        <div className="absolute -top-16 -left-16 w-64 h-64 bg-neon-purple/5 rounded-full filter blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-64 h-64 bg-neon-blue/5 rounded-full filter blur-3xl pointer-events-none" />

        {/* Round indicator */}
        <div className="text-[10px] font-heading font-bold text-neon-purple tracking-[0.25em] uppercase mb-2">
          Round {gameState?.round_num ?? 1} of {maxRounds}
        </div>

        {isActiveDrawer ? (
          <>
            <h2 className="font-heading font-black text-xl text-white mb-1">
              🎨 Pick Your Word!
            </h2>
            <p className="text-xs text-slate-400 font-sans mb-6">Choose wisely — the clock is ticking!</p>

            {/* Timer bar */}
            <div className="w-full max-w-xs h-1.5 bg-navy-border rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-neon-purple to-neon-blue rounded-full transition-all duration-1000"
                style={{ width: `${timerPct}%` }}
              />
            </div>
            <div className="font-mono font-extrabold text-2xl text-neon-blue mb-6">
              {timeLeft}s
            </div>

            {/* Word choice cards */}
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              {(gameState?.word_options || []).map((word, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectWord(word)}
                  className="flex-1 glass-panel border border-neon-purple/30 hover:border-neon-purple/80 hover:bg-neon-purple/10 text-white font-heading font-extrabold text-sm py-4 px-3 rounded-xl cursor-pointer transition-all hover:scale-105 active:scale-95 duration-150 uppercase tracking-wide"
                >
                  {word}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-4xl mb-4 animate-bounce">🧠</div>
            <h2 className="font-heading font-black text-xl text-white mb-1">
              Choosing a Word...
            </h2>
            <p className="text-xs text-slate-400 font-sans mb-6">
              The drawer is selecting their secret word. Get ready to guess!
            </p>
            <div className="w-full max-w-xs h-1.5 bg-navy-border rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-gradient-to-r from-neon-purple to-neon-pink rounded-full transition-all duration-1000"
                style={{ width: `${timerPct}%` }}
              />
            </div>
            <div className="font-mono font-extrabold text-2xl text-neon-pink">
              {timeLeft}s
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── Main Drawing Canvas (DRAWING / ENDED) ────────────────────────────────
  return (
    <div ref={containerRef} className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-navy-border/80 shadow-2xl glass-panel">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className={`w-full h-full block bg-white ${isDrawer ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
      />

      {/* Remote cursor overlay: floating neon pencil tracking the drawer's position */}
      {!isDrawer && drawerCursor && cursorStyle && (
        <div
          className="absolute pointer-events-none z-10 transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
          style={cursorStyle}
        >
          <div className="flex items-center gap-1 bg-navy-darker/80 border border-neon-purple/40 rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm">
            <span className="text-xs">✏️</span>
            <span className="font-heading font-bold text-[9px] text-neon-purple tracking-wide truncate max-w-[80px]">
              {drawerCursor.username}
            </span>
          </div>
        </div>
      )}

      {/* Spectator locked badge */}
      {!isDrawer && gameState?.status === 'DRAWING' && (
        <div className="absolute top-4 right-4 bg-red-500/10 border border-red-500/30 text-red-400 font-heading font-extrabold text-[10px] tracking-widest px-3 py-1.5 rounded-lg select-none uppercase pointer-events-none">
          👁️ SPECTATOR
        </div>
      )}

      {/* GAME OVER celebration overlay */}
      {gameState?.status === 'GAME_OVER' && (
        <div className="absolute inset-0 bg-navy-darker/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none z-20">
          <div className="flex flex-col gap-6 max-w-sm w-full glass-panel border-neon-purple/30 p-8 rounded-2xl shadow-[0_0_50px_rgba(192,132,252,0.15)] relative overflow-hidden bg-navy-darker/80">
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-neon-purple/10 rounded-full filter blur-xl" />
            <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-neon-blue/10 rounded-full filter blur-xl" />

            <div className="flex flex-col items-center gap-2">
              <span className="text-neon-purple font-heading font-extrabold text-[10px] tracking-[0.25em] uppercase">
                🏆 Grand Finale
              </span>
              <h2 className="font-heading font-black text-3xl text-white tracking-wide m-0">
                GAME OVER!
              </h2>
            </div>

            <div className="flex flex-col items-center gap-3 py-3 border-y border-navy-border/60">
              <div className="w-16 h-16 rounded-full bg-neon-yellow/10 border border-neon-yellow/20 flex items-center justify-center text-3xl animate-bounce">
                👑
              </div>
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 font-sans mt-1">Absolute Champion</span>
                <span className="font-heading font-extrabold text-xl text-neon-yellow tracking-wide uppercase mt-0.5">
                  {winner.name}
                </span>
                <span className="font-mono text-sm text-neon-blue font-bold mt-1">
                  {winner.score} PTS
                </span>
              </div>
            </div>

            {isCanvasOwner ? (
              <button
                onClick={async () => {
                  try {
                    await api.restartGame(boardID);
                  } catch (err: any) {
                    alert(err.message || 'Failed to restart game');
                  }
                }}
                className="w-full bg-gradient-to-r from-neon-purple to-neon-blue text-navy-darker font-heading font-extrabold text-xs tracking-widest py-3.5 rounded-xl hover:shadow-[0_0_20px_rgba(192,132,252,0.4)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer uppercase shrink-0"
              >
                🏁 RESTART LOBBY
              </button>
            ) : (
              <p className="text-xs text-slate-400 font-sans">Waiting for host to restart...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components for config panel ──────────────────────────────────────────

const ConfigRow: React.FC<{ label: string; icon: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[9px] font-heading font-bold text-slate-400 uppercase tracking-wider">{label}</label>
    {children}
  </div>
);

interface ConfigSelectProps {
  value: string | number;
  options: (string | number)[];
  disabled?: boolean;
  onChange: (v: string) => void;
  formatLabel?: (v: string | number) => string;
}

const ConfigSelect: React.FC<ConfigSelectProps> = ({ value, options, disabled, onChange, formatLabel }) => (
  <div className="relative">
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none bg-navy-darker border border-navy-border focus:border-neon-purple outline-none rounded-lg px-3 py-2 pr-8 text-sm text-slate-200 font-sans disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {formatLabel ? formatLabel(opt) : opt}
        </option>
      ))}
    </select>
    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
  </div>
);

export default DrawingCanvas;
