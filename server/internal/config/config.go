package config

import (
	"os"
)

type Config struct {
	Port         string
	JWTSecret    string
	PostgresDSN  string
	MongoURI     string
	MongoDBName  string
	RedisAddr    string
	RedisPass    string
}

func LoadConfig() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		JWTSecret:   getEnv("JWT_SECRET", "super_secret_scribbble_key_change_me_in_prod"),
		PostgresDSN: getEnv("DATABASE_URL", "host=localhost user=postgres password=postgrespassword dbname=scribbble_db port=5432 sslmode=disable"),
		MongoURI:    getEnv("MONGO_URI", "mongodb://localhost:27017"),
		MongoDBName: getEnv("MONGO_DB", "scribbble_ops"),
		RedisAddr:   getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:   getEnv("REDIS_PASSWORD", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
