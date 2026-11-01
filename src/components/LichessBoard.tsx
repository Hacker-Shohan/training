import React, { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';
import { DrawShape } from 'chessground/draw';
import { Key } from 'chessground/types';

interface LichessBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  turnColor: 'white' | 'black';
  dests: Map<Key, Key[]>;
  lastMove?: Key[];
  shapes?: DrawShape[];
  viewOnly?: boolean;
  onMove?: (orig: Key, dest: Key) => void;
  className?: string;
}

export const LichessBoard: React.FC<LichessBoardProps> = ({
  fen,
  orientation,
  turnColor,
  dests,
  lastMove,
  shapes = [],
  viewOnly = false,
  onMove,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates: true,
      autoCastle: true,
      viewOnly,
      highlight: {
        lastMove: true,
        check: true,
      },
      animation: {
        enabled: true,
        duration: 200,
      },
      movable: {
        free: false,
        color: viewOnly ? undefined : turnColor,
        dests,
        showDests: true,
        events: {
          after: (orig, dest) => {
            if (onMove) {
              onMove(orig, dest);
            }
          },
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        shapes,
      },
      lastMove,
    };

    apiRef.current = Chessground(containerRef.current, config);

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!apiRef.current) return;

    apiRef.current.set({
      fen,
      orientation,
      turnColor,
      viewOnly,
      movable: {
        color: viewOnly ? undefined : turnColor,
        dests,
        showDests: !viewOnly,
      },
      drawable: {
        shapes,
      },
      lastMove,
    });
  }, [fen, orientation, turnColor, dests, lastMove, shapes, viewOnly]);

  return (
    <div className={`relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl border-2 border-[#33302b] bg-[#b58863] ${className}`}>
      <div ref={containerRef} className="w-full h-full is2d" />
    </div>
  );
};
