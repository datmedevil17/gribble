package stroke

import (
	"context"
	"time"

	"scribbble/server/internal/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Service interface {
	SaveStroke(ctx context.Context, stroke *models.Stroke) error
	GetBoardHistory(ctx context.Context, boardID uint) ([]models.Stroke, error)
	ClearBoard(ctx context.Context, boardID uint) error
}

type service struct {
	collection *mongo.Collection
}

func NewService(db *mongo.Database) Service {
	return &service{
		collection: db.Collection("strokes"),
	}
}

func (s *service) SaveStroke(ctx context.Context, stroke *models.Stroke) error {
	if stroke.CreatedAt.IsZero() {
		stroke.CreatedAt = time.Now()
	}
	_, err := s.collection.InsertOne(ctx, stroke)
	return err
}

func (s *service) GetBoardHistory(ctx context.Context, boardID uint) ([]models.Stroke, error) {
	filter := bson.M{"board_id": boardID}
	// Sort by created_at ascending to ensure strokes redraw in the exact order drawn
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})

	cursor, err := s.collection.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var strokes []models.Stroke
	if err := cursor.All(ctx, &strokes); err != nil {
		return nil, err
	}

	return strokes, nil
}

func (s *service) ClearBoard(ctx context.Context, boardID uint) error {
	filter := bson.M{"board_id": boardID}
	_, err := s.collection.DeleteMany(ctx, filter)
	return err
}
