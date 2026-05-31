import React from 'react';
import { Eraser, Trash2, Brush } from 'lucide-react';

interface ToolbarProps {
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  isEraser: boolean;
  setIsEraser: (isEraser: boolean) => void;
  onClearCanvas: () => void;
  isDrawer: boolean;
}

const PRESET_COLORS = [
  '#0f172a', // Deep Slate Black
  '#ef4444', // Neon Crimson Red
  '#f97316', // Orange Sunset
  '#fbbf24', // Amber Yellow
  '#34d399', // Mint Neon Green
  '#38bdf8', // Cyber Neon Blue
  '#c084fc', // Violet Neon Purple
  '#f472b6', // Cotton Pink
];

const PRESET_SIZES = [4, 8, 16, 24, 32];

export const Toolbar: React.FC<ToolbarProps> = ({
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  isEraser,
  setIsEraser,
  onClearCanvas,
  isDrawer,
}) => {
  if (!isDrawer) {
    return (
      <div className="glass-panel p-4 rounded-xl flex items-center justify-center gap-3 text-slate-500 text-xs font-sans border border-navy-border/60">
        <Brush className="w-4 h-4" />
        <span>Spectator mode enabled. You will see drawings render in real-time.</span>
      </div>
    );
  }

  return (
    <div className="glass-panel p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-6 border border-navy-border/80 shadow-lg">
      
      {/* 1. Color Palette Grid */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase">
          Brush Color
        </span>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  setStrokeColor(color);
                  setIsEraser(false);
                }}
                style={{ backgroundColor: color }}
                className={`w-7 h-7 rounded-lg cursor-pointer transform active:scale-90 transition-all hover:scale-110 shadow-sm ${
                  strokeColor === color && !isEraser
                    ? 'ring-2 ring-neon-purple ring-offset-2 ring-offset-navy-darker scale-105'
                    : 'border border-white/5'
                }`}
                title={color}
              />
            ))}
          </div>
          
          {/* Custom Interactive Color Picker */}
          <div 
            className={`relative w-7 h-7 rounded-lg cursor-pointer overflow-hidden bg-gradient-to-tr from-pink-500 via-red-500 via-yellow-500 via-green-500 to-blue-500 hover:scale-110 active:scale-90 transition-all shadow-sm shrink-0 flex items-center justify-center ${
              !PRESET_COLORS.includes(strokeColor) && !isEraser
                ? 'ring-2 ring-neon-purple ring-offset-2 ring-offset-navy-darker scale-105'
                : 'border border-white/10'
            }`}
            title="Custom Color Picker"
          >
            <input
              type="color"
              value={isEraser || !strokeColor.startsWith('#') ? '#ffffff' : strokeColor}
              onChange={(e) => {
                setStrokeColor(e.target.value);
                setIsEraser(false);
              }}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
            {!PRESET_COLORS.includes(strokeColor) && !isEraser && (
              <div 
                style={{ backgroundColor: strokeColor }}
                className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-inner animate-pulse"
              />
            )}
          </div>
          
          {/* Active color preview dot */}
          <div 
            style={{ backgroundColor: isEraser ? 'transparent' : strokeColor }} 
            className={`w-6 h-6 rounded-full border border-navy-border shrink-0 ml-2 hidden sm:block ${isEraser ? 'bg-stripes' : ''}`}
          />
        </div>
      </div>

      {/* 2. Brush Size Selector */}
      <div className="flex flex-col gap-2 md:w-48">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase">
            Brush Size ({strokeWidth}px)
          </span>
        </div>
        <div className="flex items-center gap-3.5">
          <input
            type="range"
            min="2"
            max="50"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-full h-1 bg-navy-darker rounded-lg appearance-none cursor-pointer accent-neon-purple focus:outline-none"
          />
          
          {/* Quick preset sizes */}
          <div className="flex items-center gap-1.5 shrink-0">
            {PRESET_SIZES.slice(0, 3).map((size) => (
              <button
                key={size}
                onClick={() => setStrokeWidth(size)}
                className={`w-6 h-6 rounded-md font-mono text-[9px] font-bold flex items-center justify-center cursor-pointer transition-all border ${
                  strokeWidth === size
                    ? 'bg-neon-purple text-navy-darker border-neon-purple'
                    : 'bg-navy-darker text-slate-400 border-navy-border hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Action Tools: Eraser & Clear */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-heading font-extrabold tracking-wider text-slate-400 uppercase">
          Drawing Tools
        </span>
        <div className="flex items-center gap-2.5">
          {/* Eraser Toggle */}
          <button
            onClick={() => setIsEraser(!isEraser)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-heading font-bold tracking-wide transition-all cursor-pointer border ${
              isEraser
                ? 'bg-neon-pink text-navy-darker border-neon-pink shadow-[0_0_10px_rgba(244,114,182,0.2)]'
                : 'bg-navy-darker text-slate-300 border-navy-border hover:text-white hover:border-slate-500'
            }`}
          >
            <Eraser className="w-3.5 h-3.5" />
            ERASER
          </button>

          {/* Clear Canvas */}
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to clear the entire drawing canvas?')) {
                onClearCanvas();
              }
            }}
            className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 px-3 py-2 rounded-lg text-xs font-heading font-bold tracking-wide transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            CLEAR
          </button>
        </div>
      </div>

    </div>
  );
};
export default Toolbar;
