package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"scribbble/server/internal/config"
	"scribbble/server/internal/database"
	authHandler "scribbble/server/internal/handlers/auth"
	boardHandler "scribbble/server/internal/handlers/board"
	wsHandler "scribbble/server/internal/handlers/ws"
	"scribbble/server/internal/middleware"
	"scribbble/server/internal/models"
	authService "scribbble/server/internal/services/auth"
	boardService "scribbble/server/internal/services/board"
	gameService "scribbble/server/internal/services/game"
	strokeService "scribbble/server/internal/services/stroke"

	"github.com/gin-gonic/gin"
)

func main() {
	log.Println("Starting Scribble Go Backend...")

	// 1. Load configuration
	cfg := config.LoadConfig()

	// 2. Initialize database connections
	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("Database connection failure: %v\n", err)
	}
	defer db.Close(context.Background())

	// 3. Run GORM PostgreSQL Migrations
	log.Println("Running database migrations...")
	err = db.Postgres.AutoMigrate(
		&models.User{},
		&models.Board{},
		&models.BoardMember{},
	)
	if err != nil {
		log.Fatalf("PostgreSQL migration failure: %v\n", err)
	}
	log.Println("Database migration completed successfully!")

	// 4. Initialize services
	authSvc := authService.NewService(db.Postgres, cfg)
	boardSvc := boardService.NewService(db.Postgres)
	strokeSvc := strokeService.NewService(db.MongoDB)
	_ = gameService.NewService(db.Redis, strokeSvc) // referenced by hub internally

	// 5. Initialize central Hub and active run loops
	hub := wsHandler.NewHub(strokeSvc, db.Redis)
	go hub.Run()

	// 6. Initialize handlers
	authH := authHandler.NewHandler(authSvc)
	boardH := boardHandler.NewHandler(boardSvc)
	wsH := wsHandler.NewHandler(hub, boardSvc)

	// 7. Set up HTTP Router (Gin)
	router := gin.Default()

	// Global Middlewares
	router.Use(middleware.CORSMiddleware())

	// REST API Routes
	api := router.Group("/api")
	{
		// Public Auth Endpoints
		authGroup := api.Group("/auth")
		{
			authGroup.POST("/register", authH.Register)
			authGroup.POST("/login", authH.Login)
		}

		// Private Protected Endpoints
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(cfg))
		{
			// Board Creation and Listing
			protected.POST("/boards", boardH.Create)
			protected.GET("/boards", boardH.List)
			protected.POST("/boards/:id/join", boardH.Join)
			protected.DELETE("/boards/:id", boardH.Delete)

			// Single Board (Requires Viewer role weight or higher)
			boardGroup := protected.Group("/boards/:id")
			boardGroup.Use(middleware.RequireBoardRole(models.RoleViewer))
			{
				boardGroup.GET("", boardH.Get)
				
				// Real-time WebSocket connection route (authenticated + room checks applied!)
				boardGroup.GET("/ws", wsH.HandleConnection)
			}

			// Board Administration (Requires Admin role weight or higher)
			boardAdminGroup := protected.Group("/boards/:id")
			boardAdminGroup.Use(middleware.RequireBoardRole(models.RoleAdmin))
			{
				boardAdminGroup.POST("/members", boardH.AddMember)
				boardAdminGroup.DELETE("/members/:userId", boardH.RemoveMember)
				boardAdminGroup.POST("/restart", wsH.RestartGame)
			}
		}
	}

	// 7. Configure and run server with Graceful Shutdown
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		log.Printf("Server listening on port %s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server listen error: %v\n", err)
		}
	}()

	// Graceful Shutdown Channel Listener
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown: ", err)
	}

	log.Println("Server exited successfully.")
}
