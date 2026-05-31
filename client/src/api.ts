const API_BASE_URL = 'http://localhost:8080/api';

export interface User {
  id: number;
  username: string;
  email: string;
}

export interface BoardMember {
  id: number;
  board_id: number;
  user_id: number;
  user?: User;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
}

export interface Board {
  id: number;
  name: string;
  owner_id: number;
  owner?: User;
  created_at: string;
  members?: BoardMember[];
}

export interface PlayerScore {
  user_id: number;
  username: string;
  score: number;
}

export interface GameState {
  board_id: number;
  status: 'WAITING' | 'SELECTING_WORD' | 'DRAWING' | 'ENDED' | 'GAME_OVER';
  current_word?: string;
  drawer_id?: number;
  round_num: number;
  time_remaining: number;
  scores: Record<number, PlayerScore>;
  // Room configuration
  max_rounds: number;
  draw_time: number;
  hints: number;
  language: string;
  game_mode: string;
  word_count: number;
  custom_words: string;
  custom_words_only: boolean;
  is_started: boolean;
  // Word selection phase
  word_options?: string[];
}

export const getAuthToken = (): string | null => localStorage.getItem('token');
export const setAuthToken = (token: string) => localStorage.setItem('token', token);
export const getActiveUser = (): User | null => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
};
export const setActiveUser = (user: User) => localStorage.setItem('user', JSON.stringify(user));
export const clearAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errMsg = 'Something went wrong';
    try {
      const data = await response.json();
      errMsg = data.error || errMsg;
    } catch {
      errMsg = response.statusText || errMsg;
    }
    throw new Error(errMsg);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  // Auth Operations
  register: (username: string, email: string, password: string) =>
    request<{ message: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user_id: number; username: string; email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  // Board CRUD Operations
  createBoard: (name: string) =>
    request<Board>('/boards', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listBoards: () => request<Board[]>('/boards'),

  getBoard: (id: number) => request<Board>(`/boards/${id}`),

  joinBoard: (boardId: number) =>
    request<any>(`/boards/${boardId}/join`, {
      method: 'POST',
    }),

  deleteBoard: (boardId: number) =>
    request<{ message: string }>(`/boards/${boardId}`, {
      method: 'DELETE',
    }),

  // Board Membership Administration
  addMember: (boardId: number, email: string, role: 'ADMIN' | 'EDITOR' | 'VIEWER') =>
    request<BoardMember>(`/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  removeMember: (boardId: number, userId: number) =>
    request<{ message: string }>(`/boards/${boardId}/members/${userId}`, {
      method: 'DELETE',
    }),

  restartGame: (boardId: number) =>
    request<{ message: string }>(`/boards/${boardId}/restart`, {
      method: 'POST',
    }),
};
