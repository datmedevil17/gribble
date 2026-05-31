package models

import "time"

type Point struct {
	X float64 `bson:"x" json:"x"`
	Y float64 `bson:"y" json:"y"`
}

type Stroke struct {
	ID        string    `bson:"_id,omitempty" json:"id,omitempty"`
	BoardID   uint      `bson:"board_id" json:"board_id"`
	UserID    uint      `bson:"user_id" json:"user_id"`
	Points    []Point   `bson:"points" json:"points"`
	Color     string    `bson:"color" json:"color"`
	LineWidth float64   `bson:"line_width" json:"line_width"`
	IsEraser  bool      `bson:"is_eraser" json:"is_eraser"`
	CreatedAt time.Time `bson:"created_at" json:"created_at"`
}
