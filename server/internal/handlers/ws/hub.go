package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"scribbble/server/internal/models"
	gameSvc "scribbble/server/internal/services/game"
	strokeSvc "scribbble/server/internal/services/stroke"

	"github.com/redis/go-redis/v9"
)

type Hub struct {
	// BoardID -> map of Clients in that room
	rooms      map[uint]map[*Client]bool
	roomsMu    sync.RWMutex
	register   chan *Client
	unregister chan *Client
	broadcast  chan *models.Stroke
	strokeSvc  strokeSvc.Service
	gameSvc    gameSvc.Service
	redis      *redis.Client
	ctx        context.Context

	// Track active Redis subscriptions to prevent duplicate routines
	subs   map[uint]*redis.PubSub
	subsMu sync.Mutex

	// Track board owners (boardID -> ownerUserID)
	owners   map[uint]uint
	ownersMu sync.RWMutex
}

func NewHub(strokeSvc strokeSvc.Service, rdb *redis.Client) *Hub {
	return &Hub{
		rooms:      make(map[uint]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *models.Stroke),
		strokeSvc:  strokeSvc,
		gameSvc:    gameSvc.NewService(rdb, strokeSvc),
		redis:      rdb,
		ctx:        context.Background(),
		subs:       make(map[uint]*redis.PubSub),
		owners:     make(map[uint]uint),
	}
}

func (h *Hub) Run() {
	log.Println("WebSocket Central Hub running...")
	go h.startGameTicker()
	for {
		select {
		case client := <-h.register:
			h.handleRegister(client)

		case client := <-h.unregister:
			h.handleUnregister(client)

		case stroke := <-h.broadcast:
			h.handleBroadcast(stroke)
		}
	}
}

func (h *Hub) handleRegister(client *Client) {
	h.roomsMu.Lock()
	if h.rooms[client.BoardID] == nil {
		h.rooms[client.BoardID] = make(map[*Client]bool)
		go h.subscribeToRoom(client.BoardID)
	}
	h.rooms[client.BoardID][client] = true
	h.roomsMu.Unlock()

	log.Printf("Client %s joined board room %d\n", client.Username, client.BoardID)

	// Announce join to the room
	h.broadcastSystemMessage(client.BoardID, fmt.Sprintf("🎉 %s joined the room!", client.Username))

	// Broadcast fresh game state so new joiner sees current config
	ctx := context.Background()
	state, err := h.gameSvc.GetGameState(ctx, client.BoardID)
	if err == nil {
		stBytes, _ := json.Marshal(state)
		h.broadcastStateMessage(client.BoardID, string(stBytes))
	}

	// Broadcast live player list so all clients update standings
	h.broadcastRoomUpdate(client.BoardID)
}

func (h *Hub) handleUnregister(client *Client) {
	h.roomsMu.Lock()
	if roomClients, exists := h.rooms[client.BoardID]; exists {
		if _, clientExists := roomClients[client]; clientExists {
			delete(roomClients, client)
			close(client.Send)

			log.Printf("Client %s left board room %d\n", client.Username, client.BoardID)

			if len(roomClients) == 0 {
				delete(h.rooms, client.BoardID)
				go h.unsubscribeFromRoom(client.BoardID)
			}
		}
	}
	h.roomsMu.Unlock()

	// Broadcast updated player list to remaining clients
	h.broadcastRoomUpdate(client.BoardID)
}

// broadcastRoomUpdate sends the live connected-player list to all clients in the room.
// Frontend uses color="room_update" to refresh standings without a REST round-trip.
func (h *Hub) broadcastRoomUpdate(boardID uint) {
	type ConnectedPlayer struct {
		UserID   uint   `json:"user_id"`
		Username string `json:"username"`
	}

	h.roomsMu.RLock()
	clients := h.rooms[boardID]
	players := make([]ConnectedPlayer, 0, len(clients))
	for c := range clients {
		players = append(players, ConnectedPlayer{UserID: c.ID, Username: c.Username})
	}
	h.roomsMu.RUnlock()

	playersJSON, _ := json.Marshal(players)

	msg := &models.Stroke{
		BoardID:   boardID,
		Color:     "room_update",
		ID:        string(playersJSON),
	}
	payload, _ := json.Marshal(msg)
	channelName := fmt.Sprintf("board:%d", boardID)
	_ = h.redis.Publish(h.ctx, channelName, payload).Err()
}


// handleBroadcast saves drawing events to Mongo and publishes to Redis.
func (h *Hub) handleBroadcast(stroke *models.Stroke) {
	// Only persist actual vector drawing strokes (not cursors, chats, system events)
	if stroke.Color != "chat" && stroke.Color != "correct" && stroke.Color != "system" && stroke.Color != "cursor" {
		go func(s *models.Stroke) {
			ctx := context.Background()
			if err := h.strokeSvc.SaveStroke(ctx, s); err != nil {
				log.Printf("Failed to save stroke to MongoDB: %v\n", err)
			}
		}(stroke)
	}

	payload, err := json.Marshal(stroke)
	if err != nil {
		log.Printf("Failed to marshal stroke payload: %v\n", err)
		return
	}

	channelName := fmt.Sprintf("board:%d", stroke.BoardID)
	if err := h.redis.Publish(h.ctx, channelName, payload).Err(); err != nil {
		log.Printf("Failed to publish stroke to Redis: %v\n", err)
	}
}

// subscribeToRoom runs in its own goroutine per active board room
func (h *Hub) subscribeToRoom(boardID uint) {
	channelName := fmt.Sprintf("board:%d", boardID)
	pubsub := h.redis.Subscribe(h.ctx, channelName)

	h.subsMu.Lock()
	h.subs[boardID] = pubsub
	h.subsMu.Unlock()

	log.Printf("Subscribed to Redis Channel: %s\n", channelName)

	ch := pubsub.Channel()
	for msg := range ch {
		var stroke models.Stroke
		if err := json.Unmarshal([]byte(msg.Payload), &stroke); err != nil {
			log.Printf("Failed to unmarshal pubsub message: %v\n", err)
			continue
		}

		h.roomsMu.RLock()
		clients := h.rooms[boardID]
		for client := range clients {
			// For cursor moves: send to everyone EXCEPT the mover (they render themselves)
			// For all other events: send to everyone except the original sender
			if client.ID == stroke.UserID {
				continue
			}

			select {
			case client.Send <- []byte(msg.Payload):
			default:
				// Drop transient frames for lagging clients instead of disconnecting them
				log.Printf("Warning: Client %s buffer full, dropping transient frame\n", client.Username)
			}
		}
		h.roomsMu.RUnlock()
	}
}

func (h *Hub) unsubscribeFromRoom(boardID uint) {
	h.subsMu.Lock()
	if pubsub, exists := h.subs[boardID]; exists {
		if err := pubsub.Close(); err != nil {
			log.Printf("Error closing Redis subscription for board %d: %v\n", boardID, err)
		}
		delete(h.subs, boardID)
		log.Printf("Unsubscribed from Redis Channel for board %d\n", boardID)
	}
	h.subsMu.Unlock()
}

// isOwner checks if a given user is the first registered client (room creator) for a board.
func (h *Hub) isOwner(boardID uint, userID uint) bool {
	h.ownersMu.RLock()
	ownerID, ok := h.owners[boardID]
	h.ownersMu.RUnlock()
	if ok {
		return ownerID == userID
	}
	// Fallback: check if this user is the only or first client in the room
	h.roomsMu.RLock()
	defer h.roomsMu.RUnlock()
	clients := h.rooms[boardID]
	for c := range clients {
		if c.ID == userID {
			return true // Accept first registered
		}
		break
	}
	return false
}

// SetOwner records the board owner for permission checks.
func (h *Hub) SetOwner(boardID uint, userID uint) {
	h.ownersMu.Lock()
	h.owners[boardID] = userID
	h.ownersMu.Unlock()
}

// startGameTicker runs the centralized loop ticking once every 1 second
func (h *Hub) startGameTicker() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		h.tickActiveRooms()
	}
}

func (h *Hub) tickActiveRooms() {
	h.roomsMu.Lock()
	activeBoards := make([]uint, 0, len(h.rooms))
	for boardID := range h.rooms {
		activeBoards = append(activeBoards, boardID)
	}
	h.roomsMu.Unlock()

	for _, boardID := range activeBoards {
		h.tickRoom(boardID)
	}
}

func (h *Hub) tickRoom(boardID uint) {
	h.roomsMu.RLock()
	clients, ok := h.rooms[boardID]
	if !ok || len(clients) == 0 {
		h.roomsMu.RUnlock()
		return
	}
	clientCount := len(clients)

	var clientIDs []uint
	clientMap := make(map[uint]*Client)
	for client := range clients {
		clientIDs = append(clientIDs, client.ID)
		clientMap[client.ID] = client
	}
	h.roomsMu.RUnlock()

	ctx := context.Background()
	state, err := h.gameSvc.GetGameState(ctx, boardID)
	if err != nil {
		log.Printf("Ticker failed to fetch state for board %d: %v\n", boardID, err)
		return
	}

	// 1. Soft-pause when players drop below 2 mid-game (preserve scores)
	if clientCount < 2 && state.IsStarted && state.Status != "GAME_OVER" && state.Status != "WAITING" {
		if !state.IsPaused {
			// Transition into paused — broadcast once
			newState, err := h.gameSvc.PauseGame(ctx, boardID)
			if err == nil {
				stBytes, _ := json.Marshal(newState)
				h.broadcastStateMessage(boardID, string(stBytes))
			}
			h.broadcastSystemMessage(boardID, "⏸️ A player disconnected — game paused. Waiting for them to rejoin...")
		}
		return // skip ticking while paused
	}

	// Resume automatically when count goes back to >= 2
	if clientCount >= 2 && state.IsStarted && state.IsPaused {
		newState, err := h.gameSvc.ResumeGame(ctx, boardID)
		if err == nil {
			state = newState
			stBytes, _ := json.Marshal(state)
			h.broadcastStateMessage(boardID, string(stBytes))
			h.broadcastSystemMessage(boardID, "▶️ Player rejoined! Game resuming...")
		}
	}

	// 2. Only tick active game states — wait for explicit start_game signal in WAITING
	switch state.Status {

	case "WAITING":
		// Do not auto-start: host must click "Start Game"
		// Just broadcast state so lobby shows live config updates
		stateBytes, err := json.Marshal(state)
		if err == nil {
			h.broadcastStateMessage(boardID, string(stateBytes))
		}
		return

	case "SELECTING_WORD":
		// Tick the word-choosing countdown
		state, err = h.gameSvc.DecrementTimer(ctx, boardID)
		if err != nil {
			log.Printf("Failed to decrement SELECTING_WORD timer for board %d: %v\n", boardID, err)
			return
		}

		// If DecrementTimer auto-transitioned to DRAWING (time ran out → auto-selected word)
		if state.Status == "DRAWING" {
			// Clear the canvas for the new drawing round
			clearMsg := &models.Stroke{BoardID: boardID, Color: "clear"}
			payload, _ := json.Marshal(clearMsg)
			channelName := fmt.Sprintf("board:%d", boardID)
			_ = h.redis.Publish(h.ctx, channelName, payload).Err()

			drawerUsername := "Someone"
			if cl, ok := clientMap[state.DrawerID]; ok {
				drawerUsername = cl.Username
			}
			h.broadcastSystemMessage(boardID, fmt.Sprintf("⏱️ Time ran out! Auto-selected word. ✏️ %s is drawing!", drawerUsername))
		}

	case "DRAWING":
		state, err = h.gameSvc.DecrementTimer(ctx, boardID)
		if err != nil {
			log.Printf("Failed to decrement DRAWING timer for board %d: %v\n", boardID, err)
			return
		}

		if state.Status == "ENDED" {
			h.broadcastSystemMessage(boardID, fmt.Sprintf("⌛ Time's up! The secret word was: **%s**!", state.CurrentWord))

			go func(bID uint, currentRound int, prevDrawerID uint, maxRounds int) {
				time.Sleep(4 * time.Second)

				h.roomsMu.RLock()
				clientsList, exists := h.rooms[bID]
				if !exists || len(clientsList) == 0 {
					h.roomsMu.RUnlock()
					return
				}
				var cIDs []uint
				cMap := make(map[uint]*Client)
				for c := range clientsList {
					cIDs = append(cIDs, c.ID)
					cMap[c.ID] = c
				}
				h.roomsMu.RUnlock()

				ctxBg := context.Background()

				if currentRound >= maxRounds {
					h.endGameWithWinner(ctxBg, bID)
					return
				}

				// Pick next drawer, different from current if possible
				nextDrawerID := pickNextDrawer(cIDs, prevDrawerID)
				nextDrawerUsername := "Someone"
				if cl, ok := cMap[nextDrawerID]; ok {
					nextDrawerUsername = cl.Username
				}

				st, errStart := h.gameSvc.StartRound(ctxBg, bID, nextDrawerID, currentRound+1)
				if errStart == nil {
					h.broadcastSystemMessage(bID, fmt.Sprintf("🎨 Round %d! %s is choosing a word...", currentRound+1, nextDrawerUsername))
					stBytes, _ := json.Marshal(st)
					h.broadcastStateMessage(bID, string(stBytes))
				}
			}(boardID, state.RoundNum, state.DrawerID, state.MaxRounds)
		}

	case "GAME_OVER", "ENDED":
		// Nothing to tick
		return
	}

	// Broadcast live state to all clients every tick
	stateBytes, err := json.Marshal(state)
	if err == nil {
		h.broadcastStateMessage(boardID, string(stateBytes))
	}
}

// ─── Game Completion ────────────────────────────────────────────────────────

func (h *Hub) endGameWithWinner(ctx context.Context, boardID uint) {
	st, errEnd := h.gameSvc.EndGame(ctx, boardID)
	if errEnd != nil {
		return
	}
	winnerName := "Nobody"
	highestScore := -1
	for _, scoreObj := range st.Scores {
		if scoreObj.Score > highestScore {
			highestScore = scoreObj.Score
			winnerName = scoreObj.Username
		}
	}
	h.broadcastSystemMessage(boardID, fmt.Sprintf("🏆 Game Over! %s is the Grand Champion with %d points! 👑", winnerName, highestScore))
	stBytes, _ := json.Marshal(st)
	h.broadcastStateMessage(boardID, string(stBytes))
}

// ─── Broadcast Helpers ───────────────────────────────────────────────────────

func (h *Hub) broadcastSystemMessage(boardID uint, text string) {
	msg := &models.Stroke{
		BoardID: boardID,
		Color:   "system",
		ID:      text,
	}
	h.publishEvent(msg)
}

func (h *Hub) broadcastStateMessage(boardID uint, stateJSON string) {
	msg := &models.Stroke{
		BoardID: boardID,
		Color:   "system",
		ID:      stateJSON,
	}
	h.publishEvent(msg)
}

func (h *Hub) publishEvent(msg *models.Stroke) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return
	}
	channelName := fmt.Sprintf("board:%d", msg.BoardID)
	_ = h.redis.Publish(h.ctx, channelName, payload).Err()
}

// ─── All-Solved Detection ────────────────────────────────────────────────────

func (h *Hub) checkAllSolved(boardID uint) {
	h.roomsMu.RLock()
	clients, ok := h.rooms[boardID]
	if !ok || len(clients) <= 1 {
		h.roomsMu.RUnlock()
		return
	}

	ctx := context.Background()
	state, err := h.gameSvc.GetGameState(ctx, boardID)
	if err != nil {
		h.roomsMu.RUnlock()
		return
	}

	guessersCount := 0
	for client := range clients {
		if client.ID != state.DrawerID {
			guessersCount++
		}
	}
	h.roomsMu.RUnlock()

	solvedKey := fmt.Sprintf("game:%d:solved", boardID)
	solvedCount, err := h.redis.SCard(ctx, solvedKey).Result()
	if err != nil {
		return
	}

	if solvedCount >= int64(guessersCount) && guessersCount > 0 {
		state.Status = "ENDED"
		stateKey := fmt.Sprintf("game:%d", boardID)
		stateBytes, _ := json.Marshal(state)
		_ = h.redis.Set(ctx, stateKey, stateBytes, 0).Err()

		h.broadcastSystemMessage(boardID, "🌈 Everyone solved it! Moving to the next round! 🚀")

		go func(bID uint, currentRound int, prevDrawerID uint, maxRounds int) {
			time.Sleep(2 * time.Second)

			h.roomsMu.RLock()
			clientsList, exists := h.rooms[bID]
			if !exists || len(clientsList) == 0 {
				h.roomsMu.RUnlock()
				return
			}
			var cIDs []uint
			cMap := make(map[uint]*Client)
			for c := range clientsList {
				cIDs = append(cIDs, c.ID)
				cMap[c.ID] = c
			}
			h.roomsMu.RUnlock()

			ctxBg := context.Background()
			_ = h.redis.Del(ctxBg, fmt.Sprintf("game:%d:solved", bID)).Err()

			if currentRound >= maxRounds {
				h.endGameWithWinner(ctxBg, bID)
				return
			}

			nextDrawerID := pickNextDrawer(cIDs, prevDrawerID)
			nextDrawerUsername := "Someone"
			if cl, ok := cMap[nextDrawerID]; ok {
				nextDrawerUsername = cl.Username
			}

			st, errStart := h.gameSvc.StartRound(ctxBg, bID, nextDrawerID, currentRound+1)
			if errStart == nil {
				h.broadcastSystemMessage(bID, fmt.Sprintf("🎨 Round %d! %s is choosing a word...", currentRound+1, nextDrawerUsername))
				stBytes, _ := json.Marshal(st)
				h.broadcastStateMessage(bID, string(stBytes))
			}
		}(boardID, state.RoundNum, state.DrawerID, state.MaxRounds)
	}
}

// ─── Utilities ───────────────────────────────────────────────────────────────

func pickNextDrawer(clientIDs []uint, prevDrawerID uint) uint {
	if len(clientIDs) == 0 {
		return 0
	}
	if len(clientIDs) == 1 {
		return clientIDs[0]
	}
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for {
		next := clientIDs[r.Intn(len(clientIDs))]
		if next != prevDrawerID {
			return next
		}
	}
}
