package auth

import (
	"errors"
	"strings"

	"scribbble/server/internal/config"
	"scribbble/server/internal/models"
	"scribbble/server/internal/utils"

	"gorm.io/gorm"
)

type Service interface {
	Register(username, email, password string) (*models.User, error)
	Login(email, password string) (string, *models.User, error)
}

type service struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewService(db *gorm.DB, cfg *config.Config) Service {
	return &service{db: db, cfg: cfg}
}

func (s *service) Register(username, email, password string) (*models.User, error) {
	// Normalize email and username
	email = strings.ToLower(strings.TrimSpace(email))
	username = strings.TrimSpace(username)

	if username == "" || email == "" || password == "" {
		return nil, errors.New("all fields are required")
	}

	// Hash password
	hashedPassword, err := utils.HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Username: username,
		Email:    email,
		Password: hashedPassword,
	}

	// Save to DB
	if err := s.db.Create(user).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return nil, errors.New("username or email already exists")
		}
		return nil, err
	}

	return user, nil
}

func (s *service) Login(email, password string) (string, *models.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	if email == "" || password == "" {
		return "", nil, errors.New("email and password are required")
	}

	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, errors.New("invalid email or password")
		}
		return "", nil, err
	}

	// Verify password
	if !utils.CheckPasswordHash(password, user.Password) {
		return "", nil, errors.New("invalid email or password")
	}

	// Generate JWT Token
	token, err := utils.GenerateToken(user.ID, user.Username, user.Email, s.cfg.JWTSecret)
	if err != nil {
		return "", nil, err
	}

	return token, &user, nil
}
