package middleware

import (
	"net/http"
	"strconv"

	"scribbble/server/internal/database"
	"scribbble/server/internal/models"

	"github.com/gin-gonic/gin"
)

var rolePriority = map[models.BoardRole]int{
	models.RoleViewer: 1,
	models.RoleEditor: 2,
	models.RoleAdmin:  3,
}

func RequireBoardRole(minRole models.BoardRole) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Get authenticated user ID from context
		userIDVal, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		userID := userIDVal.(uint)

		// 2. Get board ID from route parameter (e.g., :id)
		boardIDStr := c.Param("id")
		if boardIDStr == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "board ID path parameter is required"})
			c.Abort()
			return
		}

		boardID, err := strconv.ParseUint(boardIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid board ID parameter"})
			c.Abort()
			return
		}

		// 3. Query the board_members table to check membership
		var member models.BoardMember
		err = database.DB.Postgres.
			Where("board_id = ? AND user_id = ?", uint(boardID), userID).
			First(&member).Error

		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied: you are not a member of this board"})
			c.Abort()
			return
		}

		// 4. Validate role tier
		userWeight, ok1 := rolePriority[member.Role]
		minWeight, ok2 := rolePriority[minRole]

		if !ok1 || !ok2 || userWeight < minWeight {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "access denied: insufficient permissions",
				"your_role": member.Role,
				"required_role": minRole,
			})
			c.Abort()
			return
		}

		// Inject the resolved role so handlers can make inline granular role decisions if needed
		c.Set("board_role", member.Role)

		c.Next()
	}
}
