package board

import "scribbble/server/internal/models"

type CreateBoardRequest struct {
	Name string `json:"name" binding:"required,min=2,max=100"`
}

type AddMemberRequest struct {
	Email string           `json:"email" binding:"required,email"`
	Role  models.BoardRole `json:"role" binding:"required"`
}
