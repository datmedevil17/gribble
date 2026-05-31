import React, { useState, useEffect, useRef } from 'react';
import { api, getActiveUser, getAuthToken } from '../api';
import type { Board, User, GameState } from '../api';
import { DrawingCanvas } from './DrawingCanvas';
import type { StrokePayload } from './DrawingCanvas';
import { Toolbar } from './Toolbar';
import { ScoreBoard } from './ScoreBoard';
import { ChatBox } from './ChatBox';
import type { ChatMessage } from './ChatBox';
import { ArrowLeft, Sparkles, Users, Check, Link } from 'lucide-react';

interface GameArenaProps {
  boardID: number;
  onBackToLobby: () => void;
}

// Remote cursor position tracker
interface CursorPosition {
  x: number;
  y: number;
  username: string;
}

export const GameArena: React.FC<GameArenaProps> = ({ boardID, onBackToLobby }) => {
  const [board, setBoard] = useState<Board | null>(null);
  const [wsConn, setWsConn] = useState<WebSocket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [copied, setCopied] = useState(false);
  const [gameState, setGameState] = useState<GameState>({
    board_id: boardID,
    status: 'WAITING',
    drawer_id: 0,
    time_remaining: 0,
    current_word: '',
    scores: {},
    round_num: 0,
    max_rounds: 4,
    draw_time: 80,
    hints: 3,
    language: 'English',
    game_mode: 'Normal',
    word_count: 3,
    custom_words: '',
    custom_words_only: false,
    is_started: false,
  });

  // Remote drawer cursor position
  const [drawerCursor, setDrawerCursor] = useState<CursorPosition | null>(null);

  // Brush controllers state
  const [strokeColor, setStrokeColor] = useState('#0f172a');
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentUser = getActiveUser();
  const membersMap = useRef<Record<number, string>>({});

  // Live connected player list — seeded from REST, updated via room_update WS events
  const [connectedPlayers, setConnectedPlayers] = useState<{ user_id: number; username: string }[]>([]);

  // 1. Fetch Board Details on mount to cache usernames
  const loadBoardDetails = async () => {
    try {
      const data = await api.getBoard(boardID);
      setBoard(data);

      const cache: Record<number, string> = {};
      const initial: { user_id: number; username: string }[] = [];
      if (data.members) {
        data.members.forEach((m) => {
          if (m.user) {
            cache[m.user_id] = m.user.username;
            initial.push({ user_id: m.user_id, username: m.user.username });
          }
        });
      }
      membersMap.current = cache;
      setConnectedPlayers(initial);
    } catch (err: any) {
      console.error(err.message || 'Failed to load board details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoardDetails();
  }, [boardID]);

  // 2. Connect WebSockets & listen to incoming drawing/guessing channels
  useEffect(() => {
    if (loading) return;

    const token = getAuthToken();
    const wsUrl = `ws://localhost:8080/api/boards/${boardID}/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      logSystemMessage('🎉 Connection established. Welcome to the board room!');
    };

    ws.onmessage = (event) => {
      // Handle newline-delimited batched messages
      const parts = event.data.split('\n').filter(Boolean);
      for (const part of parts) {
        try {
          handleSocketMessage(JSON.parse(part));
        } catch {
          // ignore malformed lines
        }
      }
    };

    ws.onclose = () => {
      logSystemMessage('⚠️ Connection lost. You have been disconnected.');
    };

    setWsConn(ws);
    return () => { ws.close(); };
  }, [boardID, loading]);

  const handleSocketMessage = (payload: any) => {
    if (payload.color === 'cursor') {
      // Update remote drawer cursor overlay
      if (payload.points && payload.points.length > 0) {
        setDrawerCursor({
          x: payload.points[0].x,
          y: payload.points[0].y,
          username: payload.id || 'Drawer',
        });
      }
    } else if (payload.color === 'chat') {
      appendChatMessage({
        id: Math.random().toString(),
        user_id: payload.user_id,
        username: membersMap.current[payload.user_id] || `User #${payload.user_id}`,
        text: payload.id || '',
        is_system: false,
        is_correct: false,
      });
    } else if (payload.color === 'correct') {
      logSolvedMessage(`🌟 ${membersMap.current[payload.user_id] || 'Someone'} solved the word! (+${payload.line_width} PTS)`);
      setGameState((prev: GameState) => {
        const nextScores = { ...prev.scores };
        if (!nextScores[payload.user_id]) {
          nextScores[payload.user_id] = { user_id: payload.user_id, username: '', score: 0 };
        }
        nextScores[payload.user_id].score += payload.line_width;
        return { ...prev, scores: nextScores };
      });
    } else if (payload.color === 'system') {
      if (payload.id && payload.id.startsWith('{')) {
        try {
          const state = JSON.parse(payload.id) as GameState;
          setGameState(state);
          // Clear cursor when a new round starts
          if (state.status === 'SELECTING_WORD') {
            setDrawerCursor(null);
          }
        } catch (jsonErr) {
          console.error('Failed to parse system game state:', jsonErr);
        }
      } else {
        logSystemMessage(payload.id || '');
      }
    } else if (payload.color === 'room_update') {
      // Live player list from hub — update standings without REST round-trip
      try {
        const players = JSON.parse(payload.id) as { user_id: number; username: string }[];
        setConnectedPlayers(players);
        // Also refresh the membersMap cache for chat username lookups
        players.forEach((p) => { membersMap.current[p.user_id] = p.username; });
      } catch {}
    } else if (payload.color === 'clear') {
      const canvasDom = document.querySelector('canvas') as HTMLCanvasElement;
      if (canvasDom) {
        const ctx = canvasDom.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasDom.width, canvasDom.height);
        }
      }
      setDrawerCursor(null);
    } else {
      // Drawing stroke — render directly onto canvas
      const canvasDom = document.querySelector('canvas') as HTMLCanvasElement;
      if (canvasDom) {
        const ctx = canvasDom.getContext('2d');
        if (ctx) {
          ctx.beginPath();
          ctx.strokeStyle = payload.color;
          ctx.lineWidth = payload.line_width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalCompositeOperation = payload.is_eraser ? 'destination-out' : 'source-over';

          if (payload.points && payload.points.length === 1) {
            const p = payload.points[0];
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.1, p.y + 0.1);
            ctx.stroke();
          } else if (payload.points && payload.points.length > 1) {
            ctx.moveTo(payload.points[0].x, payload.points[0].y);
            for (let i = 1; i < payload.points.length; i++) {
              ctx.lineTo(payload.points[i].x, payload.points[i].y);
            }
            ctx.stroke();
          }
        }
      }
    }
  };

  // Logging helpers
  const appendChatMessage = (msg: ChatMessage) => {
    setChatMessages((prev) => [...prev, msg]);
  };

  const logSystemMessage = (text: string) => {
    appendChatMessage({
      id: Math.random().toString(),
      user_id: 0,
      username: 'System',
      text,
      is_system: true,
      is_correct: false,
    });
  };

  const logSolvedMessage = (text: string) => {
    appendChatMessage({
      id: Math.random().toString(),
      user_id: 0,
      username: 'System',
      text,
      is_system: true,
      is_correct: true,
    });
  };

  // 3. Clear canvas trigger
  const handleClearCanvas = () => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    const clearPayload: StrokePayload = {
      board_id: boardID,
      user_id: currentUser?.id || 0,
      points: [],
      color: 'clear',
      line_width: 0,
      is_eraser: false,
    };
    wsConn.send(JSON.stringify(clearPayload));
  };

  // 4. Copy join link to clipboard
  const handleCopyLink = () => {
    const link = `${window.location.origin}/?room=${boardID}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    logSystemMessage('🔗 Copied join link to clipboard!');
  };

  // Build activeUsers from live connectedPlayers (updated via WS) merged with board owner info
  const activeUsers: User[] = connectedPlayers.map((p) => ({
    id: p.user_id,
    username: p.username,
    email: '',
    created_at: '',
  }));
  // Ensure current user is always shown even before room_update arrives
  if (currentUser && !activeUsers.some((u) => u.id === currentUser.id)) {
    activeUsers.push(currentUser);
  }

  // FIX: isDrawer only true when actively drawing this round (not permanently for room owner)
  const isDrawer = gameState?.status === 'DRAWING' && gameState?.drawer_id === currentUser?.id;
  // FIX: coerce both sides to Number to avoid string vs number mismatch
  const isOwner = !!board && Number(board.owner_id) === Number(currentUser?.id);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-darker flex items-center justify-center">
        <div className="text-center font-heading text-slate-400 font-bold text-sm animate-pulse uppercase tracking-widest">
          Synchronizing Lobby Session...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-darker px-4 py-6 relative">
      <div className="max-w-7xl mx-auto flex flex-col gap-6 relative z-10">

        {/* Navigation Header */}
        <header className="flex justify-between items-center glass-panel p-4 rounded-xl">
          <button
            onClick={onBackToLobby}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-xs font-heading font-extrabold tracking-wider transition-all cursor-pointer uppercase"
          >
            <ArrowLeft className="w-4 h-4" />
            LOBBY
          </button>

          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-neon-purple" />
            <h3 className="font-heading font-extrabold text-base text-white m-0 truncate max-w-[200px] sm:max-w-md">
              {board?.name || 'Board Arena'}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[10px] font-heading font-bold px-3 py-1.5 rounded-lg select-none uppercase tracking-wider">
              <Users className="w-3.5 h-3.5" />
              ROOM #{boardID}
            </div>

            {/* 🔗 Copy Join Link */}
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 bg-gradient-to-r from-neon-purple to-neon-blue text-navy-darker hover:brightness-110 font-heading font-extrabold text-[10px] tracking-wider px-3.5 py-1.5 rounded-lg cursor-pointer transition-all hover:scale-105 active:scale-95 duration-200 shrink-0"
              title="Copy Join Link"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  COPIED ✅
                </>
              ) : (
                <>
                  <Link className="w-3.5 h-3.5" />
                  🔗 JOIN LINK
                </>
              )}
            </button>
          </div>
        </header>

        {/* Dashboard Arena Grid Layout */}
        <div className="flex flex-col md:flex-row gap-6 items-stretch">

          {/* Left Panel: ScoreBoard Standings & Timer */}
          <ScoreBoard
            gameState={gameState}
            activeUsers={activeUsers}
            currentUserID={currentUser?.id || 0}
          />

          {/* Middle Stack: Canvas & Draw Customizer */}
          <div className="flex-1 flex flex-col gap-5 min-w-0">
            <DrawingCanvas
              boardID={boardID}
              userID={currentUser?.id || 0}
              username={currentUser?.username || ''}
              wsConn={wsConn}
              isDrawer={isDrawer}
              isOwner={isOwner}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              isEraser={isEraser}
              gameState={gameState}
              currentUserOwnerID={board?.owner_id || 0}
              drawerCursor={drawerCursor}
            />

            <Toolbar
              strokeColor={strokeColor}
              setStrokeColor={setStrokeColor}
              strokeWidth={strokeWidth}
              setStrokeWidth={setStrokeWidth}
              isEraser={isEraser}
              setIsEraser={setIsEraser}
              onClearCanvas={handleClearCanvas}
              isDrawer={isDrawer}
            />
          </div>

          {/* Right Panel: Chats & Solves */}
          <ChatBox
            wsConn={wsConn}
            chatMessages={chatMessages}
            isDrawer={isDrawer}
          />

        </div>
      </div>
    </div>
  );
};
export default GameArena;
