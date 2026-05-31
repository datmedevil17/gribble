package game

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type GameStatus string

const (
	StatusWaiting       GameStatus = "WAITING"
	StatusSelectingWord GameStatus = "SELECTING_WORD"
	StatusDrawing       GameStatus = "DRAWING"
	StatusEnded         GameStatus = "ENDED"
	StatusGameOver      GameStatus = "GAME_OVER"
)

type PlayerScore struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Score    int    `json:"score"`
}

type GameState struct {
	BoardID         uint                  `json:"board_id"`
	Status          GameStatus            `json:"status"`
	CurrentWord     string                `json:"current_word,omitempty"`
	DrawerID        uint                  `json:"drawer_id,omitempty"`
	RoundNum        int                   `json:"round_num"`
	TimeRemaining   int                   `json:"time_remaining"`
	Scores          map[uint]*PlayerScore `json:"scores"`
	// Room configuration fields
	MaxRounds       int    `json:"max_rounds"`
	DrawTime        int    `json:"draw_time"`
	Hints           int    `json:"hints"`
	Language        string `json:"language"`
	GameMode        string `json:"game_mode"`
	WordCount       int    `json:"word_count"`
	CustomWords     string `json:"custom_words"`
	CustomWordsOnly bool   `json:"custom_words_only"`
	IsStarted       bool   `json:"is_started"`
	IsPaused        bool   `json:"is_paused"` // soft-pause when < 2 players
	// Word selection phase
	WordOptions  []string `json:"word_options,omitempty"`
}

func defaultState(boardID uint) *GameState {
	return &GameState{
		BoardID:         boardID,
		Status:          StatusWaiting,
		Scores:          make(map[uint]*PlayerScore),
		MaxRounds:       4,
		DrawTime:        80,
		Hints:           3,
		Language:        "English",
		GameMode:        "Normal",
		WordCount:       3,
		CustomWords:     "",
		CustomWordsOnly: false,
		IsStarted:       false,
	}
}

type Service interface {
	GetGameState(ctx context.Context, boardID uint) (*GameState, error)
	StartRound(ctx context.Context, boardID uint, drawerID uint, roundNum int) (*GameState, error)
	SubmitGuess(ctx context.Context, boardID uint, userID uint, username string, guess string) (bool, int, error)
	DecrementTimer(ctx context.Context, boardID uint) (*GameState, error)
	EndGame(ctx context.Context, boardID uint) (*GameState, error)
	ResetGame(ctx context.Context, boardID uint) error
	GetRandomWord() string
	GetRandomWords(count int, customWords string, customWordsOnly bool) []string
	ConfigureRoom(ctx context.Context, boardID uint, maxRounds, drawTime, hints int, language, gameMode string, wordCount int, customWords string, customWordsOnly bool) (*GameState, error)
	SelectWord(ctx context.Context, boardID uint, word string) (*GameState, error)
	PauseGame(ctx context.Context, boardID uint) (*GameState, error)
	ResumeGame(ctx context.Context, boardID uint) (*GameState, error)
}

type service struct {
	redis     *redis.Client
	strokeSvc interface {
		ClearBoard(ctx context.Context, boardID uint) error
	}
}

func NewService(rdb *redis.Client, strokeSvc interface{ ClearBoard(context.Context, uint) error }) Service {
	return &service{redis: rdb, strokeSvc: strokeSvc}
}

func (s *service) GetGameState(ctx context.Context, boardID uint) (*GameState, error) {
	key := fmt.Sprintf("game:%d", boardID)
	val, err := s.redis.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return defaultState(boardID), nil
		}
		return nil, err
	}

	var state GameState
	if err := json.Unmarshal([]byte(val), &state); err != nil {
		return nil, err
	}

	// Back-fill defaults for legacy states missing config fields
	if state.MaxRounds == 0 { state.MaxRounds = 4 }
	if state.DrawTime == 0 { state.DrawTime = 80 }
	if state.Hints == 0 { state.Hints = 3 }
	if state.Language == "" { state.Language = "English" }
	if state.GameMode == "" { state.GameMode = "Normal" }
	if state.WordCount == 0 { state.WordCount = 3 }

	return &state, nil
}

func (s *service) saveGameState(ctx context.Context, state *GameState) error {
	key := fmt.Sprintf("game:%d", state.BoardID)
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return s.redis.Set(ctx, key, payload, 4*time.Hour).Err()
}

// GetRandomWords returns `count` unique random words from either the custom word pool,
// the built-in dictionary, or a blend of both.
func (s *service) GetRandomWords(count int, customWords string, customWordsOnly bool) []string {
	var pool []string

	if customWords != "" {
		parts := strings.Split(customWords, ",")
		for _, p := range parts {
			trimmed := strings.ToLower(strings.TrimSpace(p))
			if len(trimmed) >= 1 && len(trimmed) <= 32 {
				pool = append(pool, trimmed)
			}
		}
	}

	if !customWordsOnly || len(pool) < count {
		pool = append(pool, WordDictionary...)
	}

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	// Shuffle pool
	r.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })

	if count > len(pool) {
		count = len(pool)
	}
	if count == 0 {
		return []string{"apple", "banana", "cherry"}
	}
	return pool[:count]
}

// GetRandomWord returns a single random word for backwards compatibility.
func (s *service) GetRandomWord() string {
	words := s.GetRandomWords(1, "", false)
	return words[0]
}

// ConfigureRoom updates room settings while still in the WAITING lobby.
func (s *service) ConfigureRoom(ctx context.Context, boardID uint, maxRounds, drawTime, hints int, language, gameMode string, wordCount int, customWords string, customWordsOnly bool) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	if state.Status != StatusWaiting {
		return nil, errors.New("cannot configure room after game has started")
	}

	if maxRounds >= 2 && maxRounds <= 10 { state.MaxRounds = maxRounds }
	if drawTime >= 30 && drawTime <= 180 { state.DrawTime = drawTime }
	if hints >= 0 && hints <= 5 { state.Hints = hints }
	if language != "" { state.Language = language }
	if gameMode != "" { state.GameMode = gameMode }
	if wordCount >= 1 && wordCount <= 5 { state.WordCount = wordCount }
	state.CustomWords = customWords
	state.CustomWordsOnly = customWordsOnly

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}
	return state, nil
}

// SelectWord transitions state from SELECTING_WORD → DRAWING with the chosen word.
func (s *service) SelectWord(ctx context.Context, boardID uint, word string) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	if state.Status != StatusSelectingWord {
		return nil, errors.New("not currently in word selection phase")
	}

	cleanWord := strings.ToLower(strings.TrimSpace(word))
	if cleanWord == "" {
		// Auto-select first option if no valid word provided
		if len(state.WordOptions) > 0 {
			cleanWord = state.WordOptions[0]
		} else {
			cleanWord = s.GetRandomWord()
		}
	}

	state.Status = StatusDrawing
	state.CurrentWord = cleanWord
	state.WordOptions = nil
	state.TimeRemaining = state.DrawTime

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}

	if err := s.strokeSvc.ClearBoard(ctx, boardID); err != nil {
		log.Printf("Failed to clear strokes for board %d: %v", boardID, err)
	}

	return state, nil
}

// StartRound initiates the SELECTING_WORD phase for the given drawer.
func (s *service) StartRound(ctx context.Context, boardID uint, drawerID uint, roundNum int) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	// Wipe solved set for this room on new round boot
	solvedKey := fmt.Sprintf("game:%d:solved", boardID)
	_ = s.redis.Del(ctx, solvedKey).Err()

	// Ensure defaults
	if state.MaxRounds <= 0 { state.MaxRounds = 4 }
	if state.DrawTime <= 0 { state.DrawTime = 80 }
	if state.WordCount <= 0 { state.WordCount = 3 }

	state.Status = StatusSelectingWord
	state.DrawerID = drawerID
	state.CurrentWord = ""
	state.RoundNum = roundNum
	state.TimeRemaining = 15 // 15 seconds to pick a word
	state.WordOptions = s.GetRandomWords(state.WordCount, state.CustomWords, state.CustomWordsOnly)

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
		state.Scores[userID].Username = username

		// Award bonus points to drawer for successful hint delivery
		drawerID := state.DrawerID
		if _, exists := state.Scores[drawerID]; exists {
			state.Scores[drawerID].Score += 50
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

	if state.Status != StatusDrawing && state.Status != StatusSelectingWord {
		return state, nil
	}

	if state.TimeRemaining > 0 {
		state.TimeRemaining--
	}

	if state.Status == StatusSelectingWord && state.TimeRemaining == 0 {
		// Auto-select first word option when time runs out
		if len(state.WordOptions) > 0 {
			state.CurrentWord = state.WordOptions[0]
		} else {
			state.CurrentWord = s.GetRandomWord()
		}
		state.WordOptions = nil
		state.Status = StatusDrawing
		state.TimeRemaining = state.DrawTime
	} else if state.Status == StatusDrawing && state.TimeRemaining == 0 {
		state.Status = StatusEnded
	}

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}
	return state, nil
}

func (s *service) EndGame(ctx context.Context, boardID uint) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}

	state.Status = StatusGameOver
	state.WordOptions = nil

	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}
	return state, nil
}

func (s *service) ResetGame(ctx context.Context, boardID uint) error {
	key := fmt.Sprintf("game:%d", boardID)
	solvedKey := fmt.Sprintf("game:%d:solved", boardID)
	_ = s.redis.Del(ctx, solvedKey).Err()
	return s.redis.Del(ctx, key).Err()
}

// PauseGame sets IsPaused=true preserving all scores and round state.
// Called when player count drops below 2 mid-game.
func (s *service) PauseGame(ctx context.Context, boardID uint) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}
	if state.IsPaused {
		return state, nil // already paused
	}
	state.IsPaused = true
	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}
	log.Printf("Game paused for board %d (not enough players)\n", boardID)
	return state, nil
}

// ResumeGame clears the IsPaused flag so the ticker continues normally.
// Called when player count goes back to >= 2.
func (s *service) ResumeGame(ctx context.Context, boardID uint) (*GameState, error) {
	state, err := s.GetGameState(ctx, boardID)
	if err != nil {
		return nil, err
	}
	if !state.IsPaused {
		return state, nil // not paused, nothing to do
	}
	state.IsPaused = false
	if err := s.saveGameState(ctx, state); err != nil {
		return nil, err
	}
	log.Printf("Game resumed for board %d\n", boardID)
	return state, nil
}

var WordDictionary = []string{
	"apple", "banana", "cherry", "dinosaur", "elephant", "guitar", "hamburger", "igloo", "jungle", "kangaroo",
	"lemon", "monkey", "ninja", "octopus", "penguin", "queen", "rocket", "submarine", "telephone", "umbrella",
	"violin", "watermelon", "xylophone", "yacht", "zebra", "airplane", "bicycle", "castle", "dolphin", "earth",
	"fire", "giraffe", "helicopter", "island", "jacket", "koala", "lighthouse", "mountain", "notebook", "ocean",
	"pizza", "rainbow", "spaceship", "turtle", "unicorn", "volcano", "wizard", "yo-yo", "anchor", "butterfly",
	"cactus", "dragon", "feather", "goldfish", "hammer", "icecream", "key", "lantern", "magnet", "needle",
	"onion", "parachute", "quill", "rollercoaster", "snail", "telescope", "ufo", "vase", "wagon", "compass",
	"detective", "envelope", "flute", "globe", "harp", "ink", "jewelry", "keyboard", "microscope", "net",
	"owl", "potion", "quicksand", "scroll", "tombstone", "unicycle", "well", "yeti", "zipper",
	"pirate", "mermaid", "knight", "wizard", "vampire", "werewolf", "zombie", "ghost", "witch", "dragon",
	"tornado", "blizzard", "tsunami", "earthquake", "volcano", "meteor", "comet", "asteroid", "galaxy", "nebula",
	"sushi", "taco", "waffle", "pretzel", "cupcake", "donut", "pancake", "burrito", "noodle", "dumpling",
	"trumpet", "saxophone", "trombone", "ukulele", "accordion", "harmonica", "banjo", "sitar", "cello", "oboe",
}
