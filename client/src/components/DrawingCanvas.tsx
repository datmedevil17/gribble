import React, { useRef, useEffect } from 'react';
import { BoardMember } from '../api';

export interface Point {
  x: number;
  y: number;
}

export interface StrokePayload {
  id?: string;
  board_id: number;
  user_id: number;
  points: Point[];
  color: string;
  line_width: number;
  is_eraser: boolean;
}

interface DrawingCanvasProps {
  boardID: number;
  userID: number;
  wsConn: WebSocket | null;
  isDrawer: boolean;
  strokeColor: string;
  strokeWidth: number;
  isEraser: boolean;
  incomingStroke: StrokePayload | null;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  boardID,
  userID,
  wsConn,
  isDrawer,
  strokeColor,
  strokeWidth,
  isEraser,
  incomingStroke,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const points = useRef<Point[]>([]);
  const lastPos = useRef<Point>({ x: 0, y: 0 });

  // Get responsive normalized canvas coordinates
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Support mobile touch events
    let clientX = 0;
    let clientY = 0;
    
    if ('touches' in e) {
      if (e.touches.length === 0) return lastPos.current;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Convert mouse pixels to canvas standard internal 800x600 size
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  // Local helper to draw vector paths
  const drawLine = (
    ctx: CanvasRenderingContext2D,
    p1: Point,
    p2: Point,
    color: string,
    width: number,
    eraser: boolean
  ) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (eraser) {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  // 1. Local Drawing Trigger: Start
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawer) return;
    isDrawing.current = true;
    
    const pos = getCoordinates(e);
    lastPos.current = pos;
    points.current = [pos];
  };

  // 2. Local Drawing Trigger: Draw
  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !isDrawer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentPos = getCoordinates(e);
    
    // Render stroke locally instantly for ultra-smooth painting
    drawLine(ctx, lastPos.current, currentPos, strokeColor, strokeWidth, isEraser);
    
    lastPos.current = currentPos;
    points.current.push(currentPos);
  };

  // 3. Local Drawing Trigger: Stop & Send over WebSocket
  const stopDrawing = () => {
    if (!isDrawing.current || !isDrawer) return;
    isDrawing.current = false;

    if (points.current.length > 0 && wsConn && wsConn.readyState === WebSocket.OPEN) {
      const payload: StrokePayload = {
        board_id: boardID,
        user_id: userID,
        points: points.current,
        color: strokeColor,
        line_width: strokeWidth,
        is_eraser: isEraser,
      };

      // Emit stroke coordinates to the Go WebSocket Hub
      wsConn.send(JSON.stringify(payload));
    }
    points.current = [];
  };

  // 4. Remote Drawing Listener: Render incoming WebSocket strokes
  useEffect(() => {
    if (!incomingStroke) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stroke = incomingStroke;
    if (stroke.points.length === 0) return;

    // Draw the complete array of vector points chronologically
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.line_width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.is_eraser) {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    if (stroke.points.length === 1) {
      // Draw single point
      const p = stroke.points[0];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
    } else {
      // Draw complete line path
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [incomingStroke]);

  // Handle resizing / clearing canvas internally
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fixed internal high-res canvas scaling
    canvas.width = 1000;
    canvas.height = 700;
    
    // Fill canvas background
    ctx.fillStyle = '#0a0b10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div className="relative w-full aspect-[10/7] rounded-xl overflow-hidden border border-navy-border/80 shadow-2xl glass-panel">
      {/* Background canvas layer */}
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className={`w-full h-full block ${isDrawer ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
      />
      
      {/* Locked overlay tag if drawing is inactive */}
      {!isDrawer && (
        <div className="absolute top-4 right-4 bg-red-500/10 border border-red-500/30 text-red-400 font-heading font-extrabold text-[10px] tracking-widest px-3 py-1.5 rounded-lg select-none uppercase pointer-events-none uppercase">
          SPECTATOR MODE (DRAWING LOCKED)
        </div>
      )}
    </div>
  );
};
export default DrawingCanvas;
