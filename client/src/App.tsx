import { useState, useEffect } from 'react';
import { getAuthToken, clearAuth } from './api';
import AuthView from './components/AuthView';
import Dashboard from './components/Dashboard';
import GameArena from './components/GameArena';

type ViewState = 'auth' | 'dashboard' | 'game';

function App() {
  const [view, setView] = useState<ViewState>('auth');
  const [selectedBoardID, setSelectedBoardID] = useState<number | null>(null);

  // Check login state on initial render
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      setView('dashboard');
    } else {
      setView('auth');
    }
  }, []);

  const handleAuthSuccess = () => {
    setView('dashboard');
  };

  const handleSelectBoard = (boardId: number) => {
    setSelectedBoardID(boardId);
    setView('game');
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
