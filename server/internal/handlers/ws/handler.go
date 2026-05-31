package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	boardSvc "scribbble/server/internal/services/board"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local development
	},
}

type Handler struct {
	hub      *Hub
	boardSvc boardSvc.Service
}

func NewHandler(hub *Hub, boardSvc boardSvc.Service) *Handler {
	return &Handler{hub: hub, boardSvc: boardSvc}
}

func (h *Handler) HandleConnection(c *gin.Context) {
	// 1. Extract board ID from path parameters
	boardIDStr := c.Param("id")
	boardID64, err := strconv.ParseUint(boardIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID parameter"})
		return
	}
	boardID := uint(boardID64)

	// 2. Extract authenticated user details injected by AuthMiddleware
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized: user ID missing"})
		return
	}
	userID := userIDVal.(uint)

	usernameVal, exists := c.Get("username")
	username := "Anonymous"
	if exists {
		username = usernameVal.(string)
	}

	// 3. Upgrade HTTP connection to standard persistent WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("Failed to upgrade WebSocket handshake: %v\n", err)
		return
	}

	// 4. Instantiate our Client structure
	client := &Client{
		Hub:      h.hub,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		ID:       userID,
		Username: username,
		BoardID:  boardID,
	}

	// 4b. Register board owner for permission checks
	board, boardErr := h.boardSvc.GetBoard(boardID)
	if boardErr == nil && board.OwnerID == userID {
		h.hub.SetOwner(boardID, userID)
	}

	// 5. Send to register queue in the central hub event loop
	h.hub.register <- client

	// 6. Asynchronously spawn the outgoing data writer goroutine
	go client.WritePump()

	// 7. Catch-Up Feature: Fetch all drawing history from MongoDB and push to the new client
	go func(c *Client, bID uint) {
		ctx := context.Background()
		strokes, err := h.hub.strokeSvc.GetBoardHistory(ctx, bID)
		if err != nil {
			log.Printf("Failed to fetch board drawing history: %v\n", err)
			return
		}

		log.Printf("Sending %d historical strokes to catching-up user %s\n", len(strokes), c.Username)
		for _, stroke := range strokes {
			payload, err := json.Marshal(stroke)
			if err != nil {
				continue
			}
			c.Send <- payload
		}
	}(client, boardID)

	// 8. Start blocking incoming data reading pump on the main thread
	client.ReadPump()
}

func (h *Handler) RestartGame(c *gin.Context) {
	boardIDStr := c.Param("id")
	boardID64, err := strconv.ParseUint(boardIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID"})
		return
	}
	boardID := uint(boardID64)

	// 1. Reset game state in Redis (resets round counts and wipes scores)
	ctxBg := context.Background()
	err = h.hub.gameSvc.ResetGame(ctxBg, boardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 2. Broadcast the fresh WAITING state so all clients exit the GAME_OVER screen
	newState, err := h.hub.gameSvc.GetGameState(ctxBg, boardID)
	if err == nil {
		stateBytes, _ := json.Marshal(newState)
		h.hub.broadcastStateMessage(boardID, string(stateBytes))
	}

	// 3. Broadcast system announcement
	h.hub.broadcastSystemMessage(boardID, "🏁 Host restarted the game! Get ready for a new match!")

	c.JSON(http.StatusOK, gin.H{"message": "Game restarted successfully"})
}
