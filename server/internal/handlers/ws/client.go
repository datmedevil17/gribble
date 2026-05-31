package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"time"

	"scribbble/server/internal/models"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 120 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = 60 * time.Second

	// Maximum message size allowed from peer (32KB to support large point paths).
	maxMessageSize = 32768
)

type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	ID       uint
	Username string
	BoardID  uint
}

// ReadPump pumps messages from the websocket connection to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))

	// Setup Pong Handler to refresh read deadline when client responds to ping
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket connection error on client %s: %v\n", c.Username, err)
			}
			break
		}

		// 1. Parse into generic map to detect message type
		var generic map[string]interface{}
		if err := json.Unmarshal(message, &generic); err != nil {
			log.Printf("Malformed JSON message from user %s: %s\n", c.Username, string(message))
			continue
		}

		msgType, _ := generic["type"].(string)

		switch msgType {

		// ─── Real-time cursor position streaming ───────────────────────
		case "cursor_move":
			x, _ := generic["x"].(float64)
			y, _ := generic["y"].(float64)

			cursorMsg := &models.Stroke{
				BoardID:   c.BoardID,
				UserID:    c.ID,
				Color:     "cursor",
				LineWidth: x, // reuse LineWidth to carry X
				IsEraser:  false,
				Points:    []models.Point{{X: x, Y: y}},
				ID:        c.Username, // carry username in ID for label display
			}
			c.Hub.broadcast <- cursorMsg

		// ─── Chat / Guess messages ─────────────────────────────────────
		case "chat":
			text, _ := generic["text"].(string)
			ctx := context.Background()
			isCorrect, points, err := c.Hub.gameSvc.SubmitGuess(ctx, c.BoardID, c.ID, c.Username, text)
			if err != nil {
				log.Printf("SubmitGuess failed for user %s: %v\n", c.Username, err)
			}

			if isCorrect {
				// Record that this user solved the word in the current round
				solvedKey := fmt.Sprintf("game:%d:solved", c.BoardID)
				_ = c.Hub.redis.SAdd(ctx, solvedKey, c.ID).Err()

				correctMsg := &models.Stroke{
					BoardID:   c.BoardID,
					UserID:    c.ID,
					Color:     "correct",
					LineWidth: float64(points),
				}
				c.Hub.broadcast <- correctMsg

					// Instantly evaluate if everyone solved to proceed immediately
				go c.Hub.checkAllSolved(c.BoardID, c.Username)
			} else {
				chatMsg := &models.Stroke{
					BoardID: c.BoardID,
					UserID:  c.ID,
					Color:   "chat",
					ID:      text,
				}
				c.Hub.broadcast <- chatMsg
			}

		// ─── Room configuration update (owner only) ───────────────────
		case "configure_room":
			ctx := context.Background()

			// Verify this client is the board owner
			if !c.Hub.isOwner(c.BoardID, c.ID) {
				log.Printf("Non-owner %s tried to configure room %d\n", c.Username, c.BoardID)
				continue
			}

			maxRounds := int(getFloat(generic, "max_rounds", 4))
			drawTime := int(getFloat(generic, "draw_time", 80))
			hints := int(getFloat(generic, "hints", 3))
			language := getString(generic, "language", "English")
			gameMode := getString(generic, "game_mode", "Normal")
			wordCount := int(getFloat(generic, "word_count", 3))
			customWords := getString(generic, "custom_words", "")
			customWordsOnly, _ := generic["custom_words_only"].(bool)

			state, err := c.Hub.gameSvc.ConfigureRoom(ctx, c.BoardID, maxRounds, drawTime, hints, language, gameMode, wordCount, customWords, customWordsOnly)
			if err != nil {
				log.Printf("ConfigureRoom failed for board %d: %v\n", c.BoardID, err)
				continue
			}

			stBytes, _ := json.Marshal(state)
			c.Hub.broadcastStateMessage(c.BoardID, string(stBytes))

		// ─── Start game (owner only, requires >= 2 players) ────────────
		case "start_game":
			ctx := context.Background()

			if !c.Hub.isOwner(c.BoardID, c.ID) {
				log.Printf("Non-owner %s tried to start game in room %d\n", c.Username, c.BoardID)
				continue
			}

			c.Hub.roomsMu.RLock()
			clientCount := len(c.Hub.rooms[c.BoardID])
			var clientIDs []uint
			clientMap := make(map[uint]*Client)
			for cl := range c.Hub.rooms[c.BoardID] {
				clientIDs = append(clientIDs, cl.ID)
				clientMap[cl.ID] = cl
			}
			c.Hub.roomsMu.RUnlock()

			if clientCount < 2 {
				c.Hub.broadcastSystemMessage(c.BoardID, "⚠️ Need at least 2 players to start the game!")
				continue
			}

			// Mark game as started
			state, err := c.Hub.gameSvc.GetGameState(ctx, c.BoardID)
			if err != nil {
				continue
			}
			state.IsStarted = true
			if _, err := c.Hub.gameSvc.ConfigureRoom(ctx, c.BoardID, state.MaxRounds, state.DrawTime, state.Hints, state.Language, state.GameMode, state.WordCount, state.CustomWords, state.CustomWordsOnly); err != nil {
				log.Printf("ConfigureRoom pre-start failed: %v\n", err)
			}

			// Start round 1 with random drawer
			r := clientIDs[randomIndex(len(clientIDs))]
			drawerUsername := "Someone"
			if cl, ok := clientMap[r]; ok {
				drawerUsername = cl.Username
			}

			newState, err := c.Hub.gameSvc.StartRound(ctx, c.BoardID, r, 1)
			if err != nil {
				log.Printf("StartRound failed for board %d: %v\n", c.BoardID, err)
				continue
			}

			newState.IsStarted = true
			c.Hub.broadcastSystemMessage(c.BoardID, fmt.Sprintf("🎨 Game started! %s is choosing a word...", drawerUsername))
			stBytes, _ := json.Marshal(newState)
			c.Hub.broadcastStateMessage(c.BoardID, string(stBytes))

		// ─── Word selection (active drawer only) ──────────────────────
		case "select_word":
			ctx := context.Background()
			word := getString(generic, "word", "")

			state, err := c.Hub.gameSvc.GetGameState(ctx, c.BoardID)
			if err != nil {
				continue
			}

			// Only the active drawer can select
			if state.DrawerID != c.ID {
				log.Printf("Non-drawer %s tried to select word in board %d\n", c.Username, c.BoardID)
				continue
			}

			newState, err := c.Hub.gameSvc.SelectWord(ctx, c.BoardID, word)
			if err != nil {
				log.Printf("SelectWord failed for board %d: %v\n", c.BoardID, err)
				continue
			}

			// Clear canvas for all clients on new drawing round
			clearMsg := &models.Stroke{
				BoardID: c.BoardID,
				UserID:  c.ID,
				Color:   "clear",
			}
			c.Hub.broadcast <- clearMsg

			c.Hub.broadcastSystemMessage(c.BoardID, fmt.Sprintf("✏️ %s is drawing! Start guessing!", c.Username))
			stBytes, _ := json.Marshal(newState)
			c.Hub.broadcastStateMessage(c.BoardID, string(stBytes))

		// ─── Drawing stroke (default) ──────────────────────────────────
		default:
			var stroke models.Stroke
			if err := json.Unmarshal(message, &stroke); err != nil {
				log.Printf("Failed to unmarshal stroke message from user %s: %s\n", c.Username, string(message))
				continue
			}

			// Stamp stroke with secure details from WebSocket session context
			stroke.UserID = c.ID
			stroke.BoardID = c.BoardID

			c.Hub.broadcast <- &stroke
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			// Flush any queued messages in same write batch
			n := len(c.Send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte{'\n'})
				_, _ = w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func getFloat(m map[string]interface{}, key string, def float64) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return def
}

func getString(m map[string]interface{}, key string, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func randomIndex(n int) int {
	if n <= 0 {
		return 0
	}
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	return r.Intn(n)
}
