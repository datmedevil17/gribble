import { getAuthToken, clearAuth, api } from './api';
import { useState, useEffect } from 'react';
import AuthView from './components/AuthView';
import Dashboard from './components/Dashboard';
import GameArena from './components/GameArena';

type ViewState = 'auth' | 'dashboard' | 'game';

function App() {
  const [view, setView] = useState<ViewState>('auth');
  const [selectedBoardID, setSelectedBoardID] = useState<number | null>(null);

  // Check login state and handle ?room=XXXXXX join links on startup
  useEffect(() => {
    const token = getAuthToken();
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');

    if (token) {
      if (roomCode) {
        // Auto-join via URL invite link
        const roomID = parseInt(roomCode, 10);
        if (!isNaN(roomID)) {
          api.joinBoard(roomID)
            .then(() => {
              setSelectedBoardID(roomID);
              setView('game');
              // Clean up URL without reload
              window.history.replaceState({}, '', window.location.pathname);
            })
            .catch(() => {
              setView('dashboard');
            });
        } else {
          setView('dashboard');
        }
      } else {
        setView('dashboard');
      }
    } else {
      if (roomCode) {
        // Cache room code for post-auth redirect
        sessionStorage.setItem('pending_room', roomCode);
      }
      setView('auth');
    }
  }, []);

  const handleAuthSuccess = () => {
    // Check if there's a pending room join from invite link
    const pendingRoom = sessionStorage.getItem('pending_room');
    if (pendingRoom) {
      sessionStorage.removeItem('pending_room');
      const roomID = parseInt(pendingRoom, 10);
      if (!isNaN(roomID)) {
        api.joinBoard(roomID)
          .then(() => {
            setSelectedBoardID(roomID);
            setView('game');
            window.history.replaceState({}, '', window.location.pathname);
          })
          .catch(() => setView('dashboard'));
        return;
      }
    }
    setView('dashboard');
  };

  const handleSelectBoard = async (boardId: number) => {
    try {
      await api.joinBoard(boardId);
      setSelectedBoardID(boardId);
      setView('game');
    } catch (err: any) {
      alert(err.message || 'Failed to join game room');
    }
  };

  const handleBackToLobby = () => {
    setSelectedBoardID(null);
    setView('dashboard');
  };

  const handleLogout = () => {
    clearAuth();
    setView('auth');
    setSelectedBoardID(null);
  };

  return (
    <div className="min-h-screen bg-navy-darker text-slate-200">
      {view === 'auth' && (
        <AuthView onAuthSuccess={handleAuthSuccess} />
      )}

      {view === 'dashboard' && (
        <Dashboard
          onSelectBoard={handleSelectBoard}
          onLogout={handleLogout}
        />
      )}

      {view === 'game' && selectedBoardID !== null && (
        <GameArena
          boardID={selectedBoardID}
          onBackToLobby={handleBackToLobby}
        />
      )}
    </div>
  );
}

export default App;
