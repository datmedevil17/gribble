package board

import (
	"errors"

	"scribbble/server/internal/models"

	"gorm.io/gorm"
)

type Service interface {
	CreateBoard(name string, ownerID uint) (*models.Board, error)
	GetBoard(boardID uint) (*models.Board, error)
	ListBoards(userID uint) ([]models.Board, error)
	AddMember(boardID uint, email string, role models.BoardRole) (*models.BoardMember, error)
	RemoveMember(boardID uint, userID uint) error
}

type service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) Service {
	return &service{db: db}
}

func (s *service) CreateBoard(name string, ownerID uint) (*models.Board, error) {
	if name == "" {
		return nil, errors.New("board name is required")
	}

	board := &models.Board{
		Name:    name,
		OwnerID: ownerID,
	}

	// Create board and assign owner as ADMIN in a GORM transaction
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(board).Error; err != nil {
			return err
		}

		member := &models.BoardMember{
			BoardID: board.ID,
			UserID:  ownerID,
			Role:    models.RoleAdmin,
		}

		if err := tx.Create(member).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return board, nil
}

func (s *service) GetBoard(boardID uint) (*models.Board, error) {
	var board models.Board
	err := s.db.Preload("Owner").Preload("Members.User").First(&board, boardID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("board not found")
		}
		return nil, err
	}
	return &board, nil
}

func (s *service) ListBoards(userID uint) ([]models.Board, error) {
	var boards []models.Board
	// Find all boards where user is a member
	err := s.db.Joins("JOIN board_members ON board_members.board_id = boards.id").
		Where("board_members.user_id = ?", userID).
		Preload("Owner").
		Find(&boards).Error

	return boards, err
}

func (s *service) AddMember(boardID uint, email string, role models.BoardRole) (*models.BoardMember, error) {
	// 1. Find user by email
	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("user not found with that email")
		}
		return nil, err
	}

	// 2. Validate role
	if role != models.RoleAdmin && role != models.RoleEditor && role != models.RoleViewer {
		role = models.RoleViewer
	}

	member := &models.BoardMember{
		BoardID: boardID,
		UserID:  user.ID,
		Role:    role,
	}

	if err := s.db.Create(member).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) || s.db.Dialector.Name() == "postgres" && gorm.ErrDuplicatedKey.Error() == err.Error() {
			return nil, errors.New("user is already a member of this board")
		}
		// Generic duplicate key check
		return nil, errors.New("failed to add member; they may already be added")
	}

	// Preload the user details
	member.User = user
	return member, nil
}

func (s *service) RemoveMember(boardID uint, userID uint) error {
	// Find the member to ensure they exist
	var member models.BoardMember
	if err := s.db.Where("board_id = ? AND user_id = ?", boardID, userID).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("member not found in this board")
		}
		return err
	}

	// Admins cannot be removed easily without checks (optional refinement)
	if member.Role == models.RoleAdmin {
		var adminCount int64
		s.db.Model(&models.BoardMember{}).Where("board_id = ? AND role = ?", boardID, models.RoleAdmin).Count(&adminCount)
		if adminCount <= 1 {
			return errors.New("cannot remove the last administrator of the board")
		}
	}

	return s.db.Delete(&member).Error
}
