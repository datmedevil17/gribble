# Scribbble

A real-time multiplayer drawing and guessing game — a full-stack Skribbl.io clone built with Go and React. Players take turns drawing a secret word while others race to guess it, scoring points based on how quickly they figure it out.


---

##  Features

-  **Auth** — JWT-based register & login
-  **Room system** — Create rooms with 6-digit invite codes; join by ID or URL
-  **Real-time drawing** — Smooth freehand canvas streaming via WebSocket with live cursor overlay
-  **Live chat & guessing** — Guesses validated in real-time; correct answers score points
-  **Word selection** — Drawer picks from 3 random words per round
- ⏱ **Ticking timer** — Per-round countdown with progressive word hints
-  **Player avatars** — Deterministic DiceBear avatars seeded from usernames
-  **Live standings** — Score leaderboard with 🥇🥈🥉 medals ranked by score
-  **Soft-pause** — Game pauses (preserving scores) if a player disconnects; auto-resumes on rejoin
-  **Restart** — Host can reset the lobby and play again without leaving
-  **Room config** — Host configures rounds, draw time, hints, word count, language, and game mode

---

##  Architecture

```
scribbble/
├── client/          # React + TypeScript (Vite + Bun)
└── server/          # Go backend (Gin + GORM)
```

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER CLIENTS                          │
│   React SPA  ←──── HTTP REST ────→  Gin Router                  │
│              ←──── WebSocket ────→  Hub (goroutine)              │
└─────────────────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
    PostgreSQL              MongoDB               Redis
  (users, boards,       (stroke history        (game state,
   board_members)        per board)           pub/sub fanout,
                                              solved-set tracking)
```

### Why Three Databases?

| Database | Role | Why |
|----------|------|-----|
| **PostgreSQL** | Users, boards, members | Relational integrity, role enforcement via FK constraints |
| **MongoDB** | Drawing strokes | High write throughput; strokes are document-shaped and don't need joins |
| **Redis** | Game state & pub/sub | Sub-millisecond reads for ticking game state; pub/sub fan-out to all server instances |

---

## 🔁 Real-Time Data Flow

```
Client draws
    │
    ▼
WebSocket (ReadPump)
    │
    ├─── Stroke ──► hub.broadcast channel
    │                   │
    │               handleBroadcast()
    │                   ├── Save to MongoDB (async)
    │                   └── Publish to Redis channel "board:{id}"
    │
    └── All subscribed clients receive via Redis subscriber goroutine
              └── Forward to each client.Send channel
                      └── WritePump sends to browser
```

### Game State Machine

```
WAITING ──(host starts)──► SELECTING_WORD ──(word chosen / timeout)──► DRAWING
                                  ▲                                         │
                                  │                                         │
                            (next round)             (time up / all solved / ENDED)
                                  │                                         │
                                  └──────────────────────────────────────── ┘
                                                                             │
                                                              (max rounds reached)
                                                                             │
                                                                         GAME_OVER
```

State is stored as JSON in Redis (`game:{boardID}`) and broadcast to all clients on every tick via a central `startGameTicker` goroutine in the hub.

---

##  Server Structure

```
server/
├── cmd/api/main.go              # Entry point — wires services, runs router
└── internal/
    ├── config/                  # Env config loader
    ├── database/                # PostgreSQL + MongoDB + Redis connectors
    ├── handlers/
    │   ├── auth/                # Register & Login HTTP handlers
    │   ├── board/               # Board CRUD HTTP handlers
    │   └── ws/
    │       ├── hub.go           # Central WebSocket hub (rooms, pub/sub, game ticker)
    │       ├── client.go        # Per-client read/write pumps
    │       └── handler.go       # WS upgrade + REST game controls (restart etc.)
    ├── middleware/
    │   ├── auth.go              # JWT validation middleware
    │   └── role.go              # Board role enforcement (Viewer / Admin)
    ├── models/                  # GORM models: User, Board, BoardMember, Stroke
    ├── services/
    │   ├── auth/                # Register, login, JWT issue/validate
    │   ├── board/               # Create, join, list, delete boards
    │   ├── game/                # Game state machine (Redis-backed)
    │   └── stroke/              # Stroke persistence & board clear (MongoDB)
    └── utils/                   # JWT helpers, bcrypt password hashing
```

---

##  Client Structure

```
client/src/
├── api.ts                       # Typed REST + auth API client
├── App.tsx                      # Root router — auth → dashboard → game
└── components/
    ├── AuthView.tsx             # Login / Register form
    ├── Dashboard.tsx            # Room create / join / list lobby
    ├── GameArena.tsx            # Main game screen orchestrator
    ├── DrawingCanvas.tsx        # Canvas + WAITING host config + word selection
    ├── ScoreBoard.tsx           # Live standings, timer, invite code
    ├── ChatBox.tsx              # Chat feed + guess input
    ├── Toolbar.tsx              # Brush size, colors, eraser
    ├── PlayerAvatar.tsx         # DiceBear adventurer avatar (username-seeded)
    └── Iridescence.tsx          # WebGL background shader
```

---

##  API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login, returns JWT |

### Boards *(requires JWT)*
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/boards` | Create a new room |
| `GET` | `/api/boards` | List all rooms |
| `POST` | `/api/boards/:id/join` | Join a room by ID |
| `DELETE` | `/api/boards/:id` | Delete a room |
| `GET` | `/api/boards/:id` | Get room details + members |

### Game *(requires Admin role)*
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/boards/:id/restart` | Reset game state → WAITING |

### WebSocket
| Path | Description |
|------|-------------|
| `GET /api/boards/:id/ws?token=<jwt>` | Upgrade to WebSocket for real-time game |

#### WebSocket Message Types (Client → Server)

| `type` | Payload | Description |
|--------|---------|-------------|
| `cursor_move` | `{ x, y }` | Stream live cursor position |
| `chat` | `{ text }` | Send a guess / chat message |
| `configure_room` | `{ max_rounds, draw_time, ... }` | Update room settings (owner only) |
| `start_game` | — | Start the game (owner only) |
| `select_word` | `{ word }` | Drawer picks a word |

#### WebSocket Event Types (Server → Client)

| `color` field | Description |
|---------------|-------------|
| `system` | System message or game state JSON blob |
| `chat` | Chat message from another player |
| `correct` | A player guessed correctly |
| `cursor` | Remote drawer's cursor position |
| `clear` | Clear the canvas |
| `room_update` | Live connected-player list update |
| *(hex color)* | Drawing stroke data |

---

##  Setup & Running

### Prerequisites

- [Go](https://golang.org/) ≥ 1.21
- [Bun](https://bun.sh/) or Node ≥ 18
- [Docker](https://www.docker.com/) (for databases)
- [Air](https://github.com/air-verse/air) for Go hot-reload: `go install github.com/air-verse/air@latest`

---

### 1. Clone

```bash
git clone https://github.com/yourusername/scribbble.git
cd scribbble
```

---

### 2. Start the Databases

```bash
cd server
make db-up
```

This starts **PostgreSQL** (`:5432`), **MongoDB** (`:27017`), and **Redis** (`:6379`) via Docker Compose.

---

### 3. Configure the Server

Create `server/.env`:

```env
PORT=8080
JWT_SECRET=your-super-secret-key-change-me

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgrespassword
DB_NAME=scribbble_db

# MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DB=scribbble_ops

# Redis
REDIS_ADDR=localhost:6379
```

---

### 4. Run the Server

```bash
# Hot-reload (recommended for development)
make dev

# Or static run
make run

# Or build binary
make build && ./bin/server
```

Server starts on **http://localhost:8080**

---

### 5. Run the Client

```bash
cd client
bun install
bun dev
```

Client starts on **http://localhost:5173**

---

### Database Shells

```bash
make view-postgres   # psql into scribbble_db
make view-mongo      # mongosh into scribbble_ops
make view-redis      # redis-cli
```

---

##  Tech Stack

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `gin-gonic/gin` | v1.12 | HTTP router & middleware |
| `gorilla/websocket` | v1.5 | WebSocket upgrade & framing |
| `gorm.io/gorm` | v1.31 | PostgreSQL ORM + auto-migrations |
| `redis/go-redis` | v9 | Redis client + pub/sub |
| `mongo-driver` | v1.17 | MongoDB stroke storage |
| `golang-jwt/jwt` | v5 | JWT auth tokens |
| `golang.org/x/crypto` | — | bcrypt password hashing |

### Frontend
| Package | Purpose |
|---------|---------|
| React 18 + TypeScript | UI framework |
| Vite + Bun | Build tooling |
| Tailwind CSS v4 | Utility styling |
| `@dicebear/core` + `collection` | Deterministic player avatars |
| Lucide React | Icon set |
| Google Fonts (Syne, DM Sans, JetBrains Mono) | Typography |

---

##  How to Play

1. **Register** an account and log in
2. **Create a room** from the Dashboard — share the 6-digit invite code with friends
3. Friends **join by code** via "Join by ID" on their Dashboard (or use the `/?room=XXXXXX` URL)
4. Host **configures** the room: rounds, draw time, hints, word count
5. Host clicks **Start Game**
6. Each round: the **drawer picks a word** from 3 options, then draws it on the canvas
7. Other players **type guesses** in the chat — score is based on speed
8. After all rounds, **GAME OVER** shows the champion
9. Host can **Restart** for another match

---

