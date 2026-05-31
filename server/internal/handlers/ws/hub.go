package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"scribbble/server/internal/models"
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
	redis      *redis.Client
	ctx        context.Context
	
	// Track active Redis subscriptions to prevent duplicate routines
	subs   map[uint]*redis.PubSub
	subsMu sync.Mutex
}

func NewHub(strokeSvc strokeSvc.Service, rdb *redis.Client) *Hub {
	return &Hub{
		rooms:      make(map[uint]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *models.Stroke),
		strokeSvc:  strokeSvc,
		redis:      rdb,
		ctx:        context.Background(),
		subs:       make(map[uint]*redis.PubSub),
	}
}

func (h *Hub) Run() {
	log.Println("WebSocket Central Hub running...")
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
		// First client in this room: start Redis Pub/Sub subscription routine
		go h.subscribeToRoom(client.BoardID)
	}
	h.rooms[client.BoardID][client] = true
	h.roomsMu.Unlock()
	
	log.Printf("Client %s joined board room %d\n", client.Username, client.BoardID)
}

func (h *Hub) handleUnregister(client *Client) {
	h.roomsMu.Lock()
	if roomClients, exists := h.rooms[client.BoardID]; exists {
		if _, clientExists := roomClients[client]; clientExists {
			delete(roomClients, client)
			close(client.Send)
			
			log.Printf("Client %s left board room %d\n", client.Username, client.BoardID)
			
			// If room is empty, clean it up and unsubscribe from Redis to save memory
			if len(roomClients) == 0 {
				delete(h.rooms, client.BoardID)
				go h.unsubscribeFromRoom(client.BoardID)
			}
		}
	}
	h.roomsMu.Unlock()
}

func (h *Hub) handleBroadcast(stroke *models.Stroke) {
	// 1. Asynchronously save drawing history to MongoDB (fire-and-forget write-behind)
	go func(s *models.Stroke) {
		ctx := context.Background()
		if err := h.strokeSvc.SaveStroke(ctx, s); err != nil {
			log.Printf("Failed to save stroke to MongoDB: %v\n", err)
		}
	}(stroke)

	// 2. Publish drawing event to Redis Pub/Sub for horizontal scaling
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

		// Distribute the stroke coordinates to all active local clients in this room
		h.roomsMu.RLock()
		clients := h.rooms[boardID]
		for client := range clients {
			// Skip sending the stroke back to the original drawer (they already rendered it locally!)
			if client.ID == stroke.UserID {
				continue
			}
			
			select {
			case client.Send <- []byte(msg.Payload):
			default:
				// If client buffer is blocked, force close to prevent hub starvation
				go func(c *Client) {
					h.unregister <- c
				}(client)
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
