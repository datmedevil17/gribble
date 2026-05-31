package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"scribbble/server/internal/config"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Database struct {
	Postgres *gorm.DB
	Mongo    *mongo.Client
	MongoDB  *mongo.Database
	Redis    *redis.Client
}

var DB *Database

func Connect(cfg *config.Config) (*Database, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	log.Println("Connecting to PostgreSQL...")
	pgDB, err := gorm.Open(postgres.Open(cfg.PostgresDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to PostgreSQL: %w", err)
	}

	log.Println("Connecting to MongoDB...")
	mongoOpts := options.Client().ApplyURI(cfg.MongoURI)
	mongoClient, err := mongo.Connect(ctx, mongoOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	// Ping Mongo to verify connection
	if err := mongoClient.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("failed to ping MongoDB: %w", err)
	}
	mongoDatabase := mongoClient.Database(cfg.MongoDBName)

	log.Println("Connecting to Redis...")
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPass,
		DB:       0,
	})

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping Redis: %w", err)
	}

	log.Println("Successfully connected to all databases!")
	
	DB = &Database{
		Postgres: pgDB,
		Mongo:    mongoClient,
		MongoDB:  mongoDatabase,
		Redis:    rdb,
	}

	return DB, nil
}

func (db *Database) Close(ctx context.Context) {
	log.Println("Closing database connections...")
	if db.Mongo != nil {
		if err := db.Mongo.Disconnect(ctx); err != nil {
			log.Printf("Error disconnecting MongoDB: %v\n", err)
		}
	}
	if db.Redis != nil {
		if err := db.Redis.Close(); err != nil {
			log.Printf("Error closing Redis client: %v\n", err)
		}
	}
}
