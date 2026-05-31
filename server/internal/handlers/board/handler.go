package board

import (
	"net/http"
	"strconv"

	boardService "scribbble/server/internal/services/board"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	boardSvc boardService.Service
}

func NewHandler(boardSvc boardService.Service) *Handler {
	return &Handler{boardSvc: boardSvc}
}

func (h *Handler) Create(c *gin.Context) {
	var req CreateBoardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Retrieve user_id from auth middleware context
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := userIDVal.(uint)

	board, err := h.boardSvc.CreateBoard(req.Name, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, board)
}

func (h *Handler) Get(c *gin.Context) {
	boardIDStr := c.Param("id")
	boardID, err := strconv.ParseUint(boardIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID"})
		return
	}

	board, err := h.boardSvc.GetBoard(uint(boardID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, board)
}

func (h *Handler) List(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := userIDVal.(uint)

	boards, err := h.boardSvc.ListBoards(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, boards)
}

func (h *Handler) AddMember(c *gin.Context) {
	boardIDStr := c.Param("id")
	boardID, err := strconv.ParseUint(boardIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID"})
		return
	}

	var req AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	member, err := h.boardSvc.AddMember(uint(boardID), req.Email, req.Role)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, member)
}

func (h *Handler) RemoveMember(c *gin.Context) {
	boardIDStr := c.Param("id")
	boardID, err := strconv.ParseUint(boardIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID"})
		return
	}

	memberIDStr := c.Param("userId")
	memberID, err := strconv.ParseUint(memberIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid member user ID"})
		return
	}

	err = h.boardSvc.RemoveMember(uint(boardID), uint(memberID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member removed successfully"})
}
