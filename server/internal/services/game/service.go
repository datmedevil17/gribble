package game

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type GameStatus string

const (
	StatusWaiting  GameStatus = "WAITING"
	StatusDrawing  GameStatus = "DRAWING"
	StatusEnded    GameStatus = "ENDED"
)

type PlayerScore struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Score    int    `json:"score"`
}

type GameState struct {
	BoardID       uint                   `json:"board_id"`
	Status        GameStatus             `json:"status"`
	CurrentWord   string                 `json:"current_word,omitempty"` // Hashed or masked for non-drawers
	DrawerID      uint                   `json:"drawer_id,omitempty"`
	RoundNum      int                    `json:"round_num"`
	TimeRemaining int                    `json:"time_remaining"`
	Scores        map[uint]*PlayerScore  `json:"scores"`
}

type Service interface {
	GetGameState(ctx context.Context, boardID uint) (*GameState, error)
	StartRound(ctx context.Context, boardID uint, drawerID uint, word string, roundNum int) (*GameState, error)
	SubmitGuess(ctx context.Context, boardID uint, userID uint, username string, guess string) (bool, int, error)
	DecrementTimer(ctx context.Context, boardID uint) (*GameState, error)
	ResetGame(ctx context.Context, boardID uint) error
}

type service struct {
	redis *redis.Client
}

func NewService(rdb *redis.Client) Service {
	return &service{redis: rdb}
}

func (s *service) GetGameState(ctx context.Context, boardID uint) (*GameState, error) {
	key := fmt.Sprintf("game:%d", boardID)
	val, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			// Return default initial state if game room doesn't exist in Redis yet
			return &GameState{
				BoardID: boardID,
				Status:  StatusWaiting,
				Scores:  make(map[uint]*PlayerScore),
			}, nil
		}
		return nil, err
	}

	var state GameState
	if err := json.Unmarshal([]byte(val), &state); err != nil {
		return nil, err
	}

	return &state, nil
}

func (s *service) saveGameState(ctx context.Context, state *GameState) error {
	key := fmt.Sprintf("game:%d", state.BoardID)
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	// Expire game room cache after 4 hours of inactivity to prevent Redis memory leaks
	return s.redis.Set(ctx, key, payload, 4*time.Hour).Err()
}

func (s *service) StartRound(ctx context.Context, boardID uint, drawerID uint, word string, roundNum int) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	state.Status = StatusDrawing
	state.DrawerID = drawerID
	state.CurrentWord = strings.ToLower(strings.TrimSpace(word))
	state.RoundNum = roundNum
	state.TimeRemaining = 60 // 60-second default round length

	// Initialize scores map if empty
	if state.Scores == nil {
		state.Scores = make(map[uint]*PlayerScore)
	}

	// Ensure drawer exists in scores list
	if _, exists := state.Scores[drawerID]; !exists {
		state.Scores[drawerID] = &PlayerScore{UserID: drawerID, Score: 0}
	}

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}

	return state, nil
}

func (s *service) SubmitGuess(ctx context.Context, boardID uint, userID uint, username string, guess string) (bool, int, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return false, 0, err
	}

	if state.Status != StatusDrawing {
		return false, 0, nil
	}

	// Drawers cannot submit guesses to their own board!
	if userID == state.DrawerID {
		return false, 0, errors.New("drawer cannot guess their own word")
	}

	guessClean := strings.ToLower(strings.TrimSpace(guess))
	wordClean := strings.ToLower(state.CurrentWord)

	if guessClean == wordClean {
		// Calculate score award dynamically based on time left (rewards faster guesses!)
		points := 100 + (state.TimeRemaining * 5)
		
		// Update guesser's score
		if _, exists := state.Scores[userID]; !exists {
			state.Scores[userID] = &PlayerScore{UserID: userID, Username: username, Score: 0}
		}
		state.Scores[userID].Score += points
		state.Scores[userID].Username = username // ensure correct username sync

		// Award bonus points to drawer for successful hint delivery
		drawerID := state.DrawerID
		if _, exists := state.Scores[drawerID]; exists {
			state.Scores[drawerID].Score += 50 // flat 50-point hint bonus
		}

		if err := s.saveGameState(ctx, state); err != nil {
			return true, points, err
		}

		return true, points, nil
	}

	return false, 0, nil
}

func (s *service) DecrementTimer(ctx context.Context, boardID uint) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	if state.Status != StatusDrawing {
		return state, nil
	}

	if state.TimeRemaining > 0 {
		state.TimeRemaining--
	}

	if state.TimeRemaining == 0 {
		state.Status = StatusEnded
	}

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}

	return state, nil
}

func (s *service) ResetGame(ctx context.Context, boardID uint) error {
	key := fmt.Sprintf("game:%d", boardID)
	return s.redis.Del(ctx, key).Err()
}
