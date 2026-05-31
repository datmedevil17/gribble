import React, { useState, useEffect, useRef } from 'react';
import { api, getActiveUser, getAuthToken } from '../api';
import type { Board, User } from '../api';
import { DrawingCanvas } from './DrawingCanvas';
import type { StrokePayload } from './DrawingCanvas';
import { Toolbar } from './Toolbar';
import { ScoreBoard } from './ScoreBoard';
import { ChatBox } from './ChatBox';
import type { ChatMessage } from './ChatBox';
import { ArrowLeft, Sparkles, Users } from 'lucide-react';

interface GameArenaProps {
  boardID: number;
  onBackToLobby: () => void;
}

export const GameArena: React.FC<GameArenaProps> = ({ boardID, onBackToLobby }) => {
  const [board, setBoard] = useState<Board | null>(null);
  const [wsConn, setWsConn] = useState<WebSocket | null>(null);
  const [incomingStroke, setIncomingStroke] = useState<StrokePayload | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [gameState, setGameState] = useState<any>({
    board_id: boardID,
    status: 'WAITING',
    drawer_id: 0,
    time_remaining: 0,
    current_word: '',
    scores: {},
  });
  
  // Brush controllers state
  const [strokeColor, setStrokeColor] = useState('#e2e8f0');
  const [strokeWidth, setStrokeWidth] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentUser = getActiveUser();
  const membersMap = useRef<Record<number, string>>({});

  // 1. Fetch Board Details on mount to cache usernames
  const loadBoardDetails = async () => {
    try {
      const data = await api.getBoard(boardID);
      setBoard(data);
      
      // Cache user_id -> username mapping
      const cache: Record<number, string> = {};
      if (data.members) {
        data.members.forEach((m) => {
          if (m.user) {
            cache[m.user_id] = m.user.username;
          }
        });
      }
      membersMap.current = cache;
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
      logSystemMessage('Connection established. Welcome to the board room! 🎉');
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        
        // Differentiate strokes from chat messages based on our Color flag
        if (payload.color === 'chat') {
          // This is a guess/chat message
          appendChatMessage({
            id: Math.random().toString(),
            user_id: payload.user_id,
            username: membersMap.current[payload.user_id] || `User #${payload.user_id}`,
            text: payload.id || '', // raw text is packed in the ID string
            is_system: false,
            is_correct: false,
          });
        } else if (payload.color === 'correct') {
          // This is a correct guess broadcast!
          logSolvedMessage(`${membersMap.current[payload.user_id] || 'Someone'} solved the word! 🌟 (+${payload.line_width} PTS)`);
          
          // Trigger dynamic score updates locally until Redis publishes new state
          setGameState((prev: any) => {
            const nextScores = { ...prev.scores };
            if (!nextScores[payload.user_id]) {
              nextScores[payload.user_id] = { user_id: payload.user_id, score: 0 };
            }
            nextScores[payload.user_id].score += payload.line_width; // points carried in line_width
            return { ...prev, scores: nextScores };
          });
        } else if (payload.color === 'system') {
          // System announcements (e.g. round shifts)
          logSystemMessage(payload.id || '');
          if (payload.points && payload.points.length > 0) {
            // If system message has state metadata
            setGameState(payload.points);
          }
        } else {
          // This is an actual vector drawing stroke! Send it to the Canvas context
          setIncomingStroke(payload);
        }
      } catch (err) {
        logSystemMessage(`Malformed event packet: ${event.data}`);
      }
    };

    ws.onclose = () => {
      logSystemMessage('Connection lost. You have been disconnected.');
    };

    setWsConn(ws);

    return () => {
      ws.close();
    };
  }, [boardID, loading]);

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

  // 3. Clear canvas triggers
  const handleClearCanvas = () => {
    if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
    
    // Send a system stroke with zero points and color set to "clear"
    const clearPayload: StrokePayload = {
      board_id: boardID,
      user_id: currentUser?.id || 0,
      points: [],
      color: 'clear', // Flag indicating canvas clear request
      line_width: 0,
      is_eraser: false,
    };
    wsConn.send(JSON.stringify(clearPayload));
  };

  // Listen to remote clear canvas notifications
  useEffect(() => {
    if (incomingStroke?.color === 'clear') {
      const canvasDom = document.querySelector('canvas') as HTMLCanvasElement;
      if (canvasDom) {
        const ctx = canvasDom.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0a0b10';
          ctx.fillRect(0, 0, canvasDom.width, canvasDom.height);
        }
      }
      logSystemMessage('Canvas has been cleared by the drawer.');
      setIncomingStroke(null);
    }
  }, [incomingStroke]);

  // Extract active drawer and participant users list
  const activeUsers: User[] = board?.members?.map((m) => m.user).filter((u): u is User => !!u) || [];
  if (currentUser && !activeUsers.some((u) => u.id === currentUser.id)) {
    activeUsers.push(currentUser);
  }

  // Active drawer condition check
  // For standard mock game loop, let the board owner draw, or dynamic logic
  const isDrawer = board?.owner_id === currentUser?.id || gameState?.drawer_id === currentUser?.id;

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

          <div className="flex items-center gap-1 bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[10px] font-heading font-bold px-3 py-1.5 rounded-lg select-none uppercase tracking-wider">
            <Users className="w-3.5 h-3.5" />
            ROOM #{boardID}
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
              wsConn={wsConn}
              isDrawer={isDrawer}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              isEraser={isEraser}
              incomingStroke={incomingStroke}
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
