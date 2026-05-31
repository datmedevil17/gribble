package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

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
	hub *Hub
}

func NewHandler(hub *Hub) *Handler {
	return &Handler{hub: hub}
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
