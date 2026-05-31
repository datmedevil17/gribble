import React, { useState, useEffect } from 'react';
import { api, getActiveUser } from '../api';
import type { Board } from '../api';
import { Plus, LogOut, ArrowRight, Layers, Sparkles, RefreshCw, Trash2 } from 'lucide-react';

interface DashboardProps {
  onSelectBoard: (boardId: number) => void;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSelectBoard, onLogout }) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [newBoardName, setNewBoardName] = useState('');
  const [joinID, setJoinID] = useState('');
  const [loading, setLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const user = getActiveUser();

  const fetchBoards = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listBoards();
      // Sort boards by id descending to display newest rooms first
      setBoards(data.sort((a, b) => b.id - a.id));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch board rooms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoards();
  }, []);

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    
    setCreateLoading(true);
    setError(null);
    try {
      const newBoard = await api.createBoard(newBoardName);
      setNewBoardName('');
      // Refresh boards list
      await fetchBoards();
      // Auto join newly created board
      onSelectBoard(newBoard.id);
    } catch (err: any) {
      setError(err.message || 'Failed to create board');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleJoinByID = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinID.trim()) return;
    const id = parseInt(joinID.trim(), 10);
    if (isNaN(id)) return;
    onSelectBoard(id);
  };

  return (
    <div className="min-h-screen bg-navy-darker px-4 py-8 relative">
      {/* Dynamic background lighting */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-neon-blue/3 rounded-full filter blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-10 left-1/4 w-96 h-96 bg-neon-purple/3 rounded-full filter blur-[120px] pointer-events-none"></div>

      <div className="max-w-5xl mx-auto relative z-10 flex flex-col gap-8">
        {/* Navigation & Header */}
        <header className="flex justify-between items-center glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-3">
            <Layers className="w-8 h-8 text-neon-purple" />
            <div>
              <h2 className="font-heading font-extrabold text-2xl text-white m-0">
                Scribbble Lobby
              </h2>
              <p className="text-xs text-slate-400 font-sans mt-0.5">
                Welcome back, <span className="text-neon-blue font-semibold">{user?.username || 'Player'}</span> 👋
              </p>
            </div>
          </div>
          
          <button
            onClick={onLogout}
            className="flex items-center gap-2 border border-red-500/20 hover:bg-red-500/10 text-red-400 px-4 py-2 rounded-xl text-sm font-heading font-semibold tracking-wide transition-all cursor-pointer hover:border-red-500/40 active:scale-95 duration-200"
          >
            <LogOut className="w-4 h-4" />
            LOGOUT
          </button>
        </header>

        {/* Global Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 px-5 py-4 rounded-xl text-sm font-sans flex justify-between items-center">
            <p className="m-0 font-medium">{error}</p>
            <button
              onClick={fetchBoards}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 font-heading font-bold cursor-pointer uppercase"
            >
              <RefreshCw className="w-3.5 h-3.5" /> RE-TRY
            </button>
          </div>
        )}

        {/* Dashboard Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Left Column: Create Room & Join Room Forms */}
          <div className="md:col-span-1">
            <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6 sticky top-8">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-5 h-5 text-neon-purple" />
                  <h3 className="font-heading font-extrabold text-lg text-white m-0">
                    Host New Board
                  </h3>
                </div>

                <form onSubmit={handleCreateBoard} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-heading font-bold tracking-wider text-slate-400 uppercase">
                      Board / Room Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newBoardName}
                      onChange={(e) => setNewBoardName(e.target.value)}
                      placeholder="e.g. Pixel Pioneers"
                      className="w-full bg-navy-darker border border-navy-border focus:border-neon-purple focus:ring-1 focus:ring-neon-purple outline-none rounded-lg px-4 py-3 text-sm text-slate-200 transition-all font-sans"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={createLoading || !newBoardName.trim()}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-neon-purple to-neon-blue text-navy-darker font-heading font-bold text-xs tracking-wide py-3.5 rounded-lg hover:shadow-[0_0_15px_rgba(192,132,252,0.3)] hover:brightness-110 active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed uppercase"
                  >
                    <Plus className="w-4 h-4 stroke-[3px]" />
                    {createLoading ? 'Hosting...' : 'Host Room'}
                  </button>
                </form>
              </div>

              {/* Separator line */}
              <div className="border-t border-navy-border/60"></div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <ArrowRight className="w-5 h-5 text-neon-blue" />
                  <h3 className="font-heading font-extrabold text-lg text-white m-0">
                    Join Room by ID
                  </h3>
                </div>

                <form onSubmit={handleJoinByID} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-heading font-bold tracking-wider text-slate-400 uppercase">
                      Room Number / ID
                    </label>
                    <input
                      type="number"
                      required
                      value={joinID}
                      onChange={(e) => setJoinID(e.target.value)}
                      placeholder="e.g. 42"
                      className="w-full bg-navy-darker border border-navy-border focus:border-neon-blue focus:ring-1 focus:ring-neon-blue outline-none rounded-lg px-4 py-3 text-sm text-slate-200 transition-all font-sans"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!joinID.trim()}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-neon-blue to-neon-purple text-navy-darker font-heading font-bold text-xs tracking-wide py-3.5 rounded-lg hover:shadow-[0_0_15px_rgba(56,189,248,0.3)] hover:brightness-110 active:scale-[0.98] transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed uppercase"
                  >
                    <ArrowRight className="w-4 h-4 stroke-[3px]" />
                    Join Room
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Right Column: Active Rooms Grid */}
          <div className="md:col-span-2 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-extrabold text-lg text-white m-0">
                Active Game Rooms ({boards.length})
              </h3>
              <button
                onClick={fetchBoards}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-neon-blue hover:text-white transition-colors cursor-pointer font-heading font-bold disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                REFRESH LOBBY
              </button>
            </div>

            {loading && boards.length === 0 ? (
              // Loading Skeleton
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="glass-panel p-5 rounded-2xl h-36 animate-pulse bg-white/[0.01]"></div>
                ))}
              </div>
            ) : boards.length === 0 ? (
              // Empty State
              <div className="glass-panel p-12 rounded-2xl text-center border-dashed border-navy-border">
                <Sparkles className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h4 className="font-heading font-bold text-base text-slate-300 m-0">
                  Lobby is completely quiet
                </h4>
                <p className="text-xs text-slate-500 font-sans mt-2 max-w-sm mx-auto">
                  There are no active drawing boards running right now. Be the first to host one on the left panel!
                </p>
              </div>
            ) : (
              // Active Rooms List Grid
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {boards.map((board) => (
                  <div
                    key={board.id}
                    className="glass-panel p-5 rounded-2xl hover:border-neon-purple/40 hover:shadow-[0_0_15px_rgba(192,132,252,0.02)] transition-all duration-300 flex flex-col justify-between group"
                  >
                    <div>
                      <h4 className="font-heading font-bold text-base text-white m-0 group-hover:text-neon-purple transition-colors truncate">
                        {board.name}
                      </h4>
                      <p className="text-[10px] font-sans text-slate-500 mt-1 uppercase tracking-wider">
                        HOST ID: <span className="text-slate-400">#{board.owner_id}</span>
                      </p>
                    </div>

                    <div className="flex justify-between items-center mt-6 pt-3 border-t border-navy-border/60">
                      <span className="text-[11px] font-sans text-slate-400">
                        Room <span className="text-neon-blue font-semibold">#{board.id}</span>
                      </span>
                      
                      <div className="flex items-center gap-3">
                        {board.owner_id === user?.id && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (window.confirm(`Are you sure you want to permanently delete room "${board.name}"?`)) {
                                try {
                                  await api.deleteBoard(board.id);
                                  await fetchBoards();
                                } catch (err: any) {
                                  alert(err.message || 'Failed to delete room');
                                }
                              }
                            }}
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg cursor-pointer transition-all hover:scale-110 active:scale-95 duration-200"
                            title="Delete Room"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        
                        <button
                          onClick={() => onSelectBoard(board.id)}
                          className="flex items-center gap-1.5 text-xs font-heading font-bold tracking-wider text-neon-blue hover:text-white cursor-pointer group-hover:translate-x-0.5 transition-all"
                        >
                          JOIN GAME
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
};
export default Dashboard;
