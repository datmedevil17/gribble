package models

import (
	"time"

	"gorm.io/gorm"
)

type BoardRole string

const (
	RoleAdmin  BoardRole = "ADMIN"
	RoleEditor BoardRole = "EDITOR"
	RoleViewer BoardRole = "VIEWER"
)

type Board struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"not null" json:"name"`
	OwnerID   uint           `gorm:"not null" json:"owner_id"`
	Owner     User           `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
	Members   []BoardMember  `json:"members,omitempty"`
}

type BoardMember struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	BoardID   uint           `gorm:"uniqueIndex:idx_board_user;not null" json:"board_id"`
	UserID    uint           `gorm:"uniqueIndex:idx_board_user;not null" json:"user_id"`
	User      User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Role      BoardRole      `gorm:"type:varchar(20);default:'VIEWER';not null" json:"role"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
