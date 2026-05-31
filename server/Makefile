.PHONY: help run dev build db-up db-down db-logs db-status view-postgres view-mongo view-redis

# Help target to display available commands
help:
	@echo "=================================================================="
	@echo "                  SCRIBBBLE SERVER MAKEFILE                       "
	@echo "=================================================================="
	@echo "Go Commands:"
	@echo "  make run             - Run the Go REST API server locally (static)"
	@echo "  make dev             - Run with live hot-reloading using Air"
	@echo "  make build           - Compile the server binary into bin/server"
	@echo ""
	@echo "Docker Stack Commands:"
	@echo "  make db-up           - Start Postgres, MongoDB, and Redis in background"
	@echo "  make db-down         - Stop and remove database containers"
	@echo "  make db-logs         - Tail live container streaming logs"
	@echo "  make db-status       - Display running container status"
	@echo ""
	@echo "Database Terminal Viewers:"
	@echo "  make view-postgres   - Open terminal interactive SQL client (psql)"
	@echo "  make view-mongo      - Open terminal interactive Mongo shell (mongosh)"
	@echo "  make view-redis      - Open terminal interactive Redis shell (redis-cli)"
	@echo "=================================================================="

# Go Commands
run:
	go run cmd/api/main.go

dev:
	air


build:
	mkdir -p bin
	go build -o bin/server cmd/api/main.go

# Docker Stack
db-up:
	docker compose up -d

db-down:
	docker compose down

db-logs:
	docker compose logs -f

db-status:
	docker compose ps

# Terminal Database Viewers
view-postgres:
	docker exec -it scribbble_postgres psql -U postgres -d scribbble_db

view-mongo:
	docker exec -it scribbble_mongodb mongosh scribbble_ops

view-redis:
	docker exec -it scribbble_redis redis-cli
