package ws

import (
	"encoding/json"
	"log"
	"time"

	"scribbble/server/internal/models"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer (16KB to support large point paths).
	maxMessageSize = 16384
)

type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	Send     chan []byte
	ID       uint
	Username string
	BoardID  uint
}

// readPump pumps messages from the websocket connection to the hub.
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

		// 1. Attempt to parse as a drawing stroke
		var stroke models.Stroke
		if err := json.Unmarshal(message, &stroke); err != nil {
			// If not a stroke, it could be a chat or system message (to expand in state engines)
			log.Printf("Non-stroke message received from user %s: %s\n", c.Username, string(message))
			continue
		}

		// 2. Strict Security: stamp coordinates with authentic UserID & BoardID from context
		// This prevents clients from spoofing other rooms or users
		stroke.UserID = c.ID
		stroke.BoardID = c.BoardID

		// 3. Dispatch to the room's central hub loop
		c.Hub.broadcast <- &stroke
	}
}

// writePump pumps messages from the hub to the websocket connection.
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
				// The Hub closed the channel.
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			// Add queued chat/stroke messages to the current websocket writer
			n := len(c.Send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte{'\n'})
				_, _ = w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			// Periodically send ping messages to keep connection active
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
