import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Chess } from 'chess.js';
import { Key } from 'chessground/types';
import { DrawShape } from 'chessground/draw';
import { LichessBoard } from './LichessBoard';
import { EvalBar } from './EvalBar';
import { sounds } from '../utils/sound';
import type { ChessPuzzle } from '../types';
import defaultPuzzlesData from '../data/puzzles.json';

// Convert chess.js instance to chessground dests map
function toDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  chess.moves({ verbose: true }).forEach((m) => {
    const from = m.from as Key;
    const to = m.to as Key;
    const ms = dests.get(from);
    if (ms) ms.push(to);
    else dests.set(from, [to]);
  });
  return dests;
}

export const TrainingApp: React.FC = () => {
  // Puzzles dataset
  const [allPuzzles, setAllPuzzles] = useState<ChessPuzzle[]>(
    (defaultPuzzlesData as { puzzles: ChessPuzzle[] }).puzzles || []
  );

  // Solved IDs from localStorage
  const [solvedIds, setSolvedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('shohan_training_solved');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Streak
  const [streak, setStreak] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('shohan_training_streak');
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });

  // Sound toggle
  const [soundEnabled, setSoundEnabled] = useState<boolean>(sounds.enabled);

  // Filters
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [colorFilter, setColorFilter] = useState<'all' | 'white' | 'black'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unsolved' | 'solved'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Filtered puzzle list
  const filteredPuzzles = useMemo(() => {
    return allPuzzles.filter((p) => {
      if (themeFilter !== 'all') {
        const matchesCat = p.category.toLowerCase().includes(themeFilter.toLowerCase());
        const matchesTheme = p.primary_theme.toLowerCase().includes(themeFilter.toLowerCase());
        if (!matchesCat && !matchesTheme) return false;
      }
      if (colorFilter !== 'all' && p.player_color !== colorFilter) {
        return false;
      }
      if (statusFilter === 'solved' && !solvedIds.has(p.id)) return false;
      if (statusFilter === 'unsolved' && solvedIds.has(p.id)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesOpp = p.opponent.toLowerCase().includes(q);
        const matchesOpening = p.opening_name.toLowerCase().includes(q);
        const matchesEco = p.opening_eco.toLowerCase().includes(q);
        if (!matchesOpp && !matchesOpening && !matchesEco) return false;
      }
      return true;
    });
  }, [allPuzzles, themeFilter, colorFilter, statusFilter, searchQuery, solvedIds]);

  // Current Index in filtered list
  const [filteredIndex, setFilteredIndex] = useState<number>(0);

  // Current Puzzle
  const currentPuzzle = filteredPuzzles[filteredIndex] || allPuzzles[0];

  // Board & Chess State
  const [chess, setChess] = useState<Chess>(() => new Chess());
  const [boardFen, setBoardFen] = useState<string>('');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [dests, setDests] = useState<Map<Key, Key[]>>(new Map());
  const [lastMove, setLastMove] = useState<Key[]>([]);
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [viewOnly, setViewOnly] = useState<boolean>(false);

  // Interaction feedback state
  const [feedback, setFeedback] = useState<{
    type: 'idle' | 'success' | 'solved' | 'blunder' | 'error' | 'hint';
    message: string;
  }>({
    type: 'idle',
    message: 'Find the winning move!',
  });

  // Track continuation line progress
  const [continuationStep, setContinuationStep] = useState<number>(0);

  // Initialize or change puzzle
  const loadPuzzle = useCallback(
    (puzzle: ChessPuzzle) => {
      if (!puzzle) return;
      try {
        const newChess = new Chess(puzzle.fen);
        setChess(newChess);
        setBoardFen(newChess.fen());
        setOrientation(puzzle.player_color);
        setDests(toDests(newChess));
        setLastMove([]);
        setShapes([]);
        setViewOnly(false);
        setContinuationStep(0);

        setFeedback({
          type: 'idle',
          message: `${puzzle.turn} to move • Find the winning tactic!`,
        });
      } catch (err) {
        console.error('Failed to load puzzle FEN:', puzzle.fen, err);
      }
    },
    []
  );

  useEffect(() => {
    if (currentPuzzle) {
      loadPuzzle(currentPuzzle);
    }
  }, [currentPuzzle, loadPuzzle]);

  // Handle User Move on Board
  const handleMove = useCallback(
    (orig: Key, dest: Key) => {
      if (viewOnly) return;

      const expectedSan = currentPuzzle.best_move_san;
      const expectedUci = currentPuzzle.best_move_uci;
      const playedUci = orig + dest;

      // Try making the move in chess.js
      const tempChess = new Chess(chess.fen());
      const move = tempChess.move({ from: orig, to: dest, promotion: 'q' });

      if (!move) {
        sounds.playError();
        return;
      }

      const isWinningMove =
        move.san === expectedSan ||
        playedUci === expectedUci.slice(0, 4) ||
        (expectedUci.length >= 5 && playedUci === expectedUci.slice(0, 4));

      const isGameBlunder =
        move.san === currentPuzzle.played_move_san ||
        playedUci === currentPuzzle.played_move_uci.slice(0, 4);

      if (isWinningMove) {
        // Correct Move!
        if (move.captured) sounds.playCapture();
        else sounds.playMove();

        if (tempChess.isCheck()) {
          setTimeout(() => sounds.playCheck(), 100);
        }

        setChess(tempChess);
        setBoardFen(tempChess.fen());
        setLastMove([orig, dest]);
        setDests(toDests(tempChess));
        setShapes([
          {
            orig,
            dest,
            brush: 'green',
          },
        ]);

        // Check if there is an opponent response in continuation
        const continuation = currentPuzzle.continuation_san || [];
        const nextOpponentMoveSan = continuation[1]; // Opponent response

        if (nextOpponentMoveSan && !tempChess.isGameOver()) {
          setViewOnly(true);
          setFeedback({
            type: 'success',
            message: `🎉 Correct move (${move.san})! Stockfish is calculating opponent reply...`,
          });

          // Play opponent response after brief natural delay
          setTimeout(() => {
            const oppChess = new Chess(tempChess.fen());
            try {
              const oppMove = oppChess.move(nextOpponentMoveSan);
              if (oppMove) {
                if (oppMove.captured) sounds.playCapture();
                else sounds.playMove();

                if (oppChess.isCheck()) {
                  setTimeout(() => sounds.playCheck(), 100);
                }

                setChess(oppChess);
                setBoardFen(oppChess.fen());
                setLastMove([oppMove.from as Key, oppMove.to as Key]);
                setDests(toDests(oppChess));
                setViewOnly(false);

                // Check for follow-up move
                const followUpSan = continuation[2];
                if (followUpSan) {
                  setFeedback({
                    type: 'idle',
                    message: `Opponent played ${oppMove.san}. Now find the follow-up blow!`,
                  });
                  setContinuationStep(2);
                } else {
                  onPuzzleFullySolved();
                }
              } else {
                onPuzzleFullySolved();
              }
            } catch {
              onPuzzleFullySolved();
            }
          }, 450);
        } else {
          onPuzzleFullySolved();
        }
      } else if (isGameBlunder) {
        // User played their actual game blunder
        sounds.playError();
        setShapes([
          {
            orig,
            dest,
            brush: 'red',
          },
        ]);
        setFeedback({
          type: 'blunder',
          message: `⚠️ That's what you played in the game (${move.san})! Eval crashed from ${currentPuzzle.eval_before} to ${currentPuzzle.eval_after_played}. Find the knockout shot!`,
        });

        // Snap back
        setTimeout(() => {
          setBoardFen(chess.fen());
          setDests(toDests(chess));
        }, 300);
      } else {
        // Incorrect Move
        sounds.playError();
        setStreak(0);
        localStorage.setItem('shohan_training_streak', '0');

        setShapes([
          {
            orig,
            dest,
            brush: 'red',
          },
        ]);
        setFeedback({
          type: 'error',
          message: `❌ Not the best move (${move.san}). Try again or ask for a hint!`,
        });

        // Snap back
        setTimeout(() => {
          setBoardFen(chess.fen());
          setDests(toDests(chess));
        }, 300);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chess, currentPuzzle, viewOnly]
  );

  const onPuzzleFullySolved = useCallback(() => {
    sounds.playSuccess();
    setViewOnly(true);

    setSolvedIds((prev) => {
      const next = new Set(prev).add(currentPuzzle.id);
      localStorage.setItem('shohan_training_solved', JSON.stringify([...next]));
      return next;
    });

    setStreak((prev) => {
      const next = prev + 1;
      localStorage.setItem('shohan_training_streak', String(next));
      return next;
    });

    setFeedback({
      type: 'solved',
      message: `🏆 Puzzle Solved! Stockfish advantage: ${currentPuzzle.eval_before}. Great tactical eye!`,
    });
  }, [currentPuzzle]);

  // Hint button
  const handleHint = useCallback(() => {
    if (!currentPuzzle) return;
    const fromSq = currentPuzzle.best_move_uci.slice(0, 2) as Key;
    setShapes([
      {
        orig: fromSq,
        brush: 'yellow',
      },
    ]);
    setFeedback({
      type: 'hint',
      message: `💡 Hint: Focus on piece on ${fromSq.toUpperCase()}! Theme: ${currentPuzzle.primary_theme}.`,
    });
  }, [currentPuzzle]);

  // Reveal Solution
  const handleRevealSolution = useCallback(() => {
    if (!currentPuzzle) return;
    const fromSq = currentPuzzle.best_move_uci.slice(0, 2) as Key;
    const toSq = currentPuzzle.best_move_uci.slice(2, 4) as Key;

    setShapes([
      {
        orig: fromSq,
        dest: toSq,
        brush: 'green',
      },
    ]);

    try {
      const temp = new Chess(currentPuzzle.fen);
      const m = temp.move({ from: fromSq, to: toSq, promotion: 'q' });
      if (m) {
        sounds.playMove();
        setChess(temp);
        setBoardFen(temp.fen());
        setLastMove([fromSq, toSq]);
        setViewOnly(true);
      }
    } catch {}

    setFeedback({
      type: 'solved',
      message: `👁️ Solution: ${currentPuzzle.best_move_san}! Continuation: ${currentPuzzle.continuation_str}`,
    });
  }, [currentPuzzle]);

  // Show Game Move
  const handleShowGameBlunder = useCallback(() => {
    if (!currentPuzzle) return;
    const fromSq = currentPuzzle.played_move_uci.slice(0, 2) as Key;
    const toSq = currentPuzzle.played_move_uci.slice(2, 4) as Key;

    setShapes([
      {
        orig: fromSq,
        dest: toSq,
        brush: 'red',
      },
    ]);

    setFeedback({
      type: 'blunder',
      message: `⏪ In the game you played ${currentPuzzle.played_move_san}. Eval fell from ${currentPuzzle.eval_before} to ${currentPuzzle.eval_after_played} (-${(currentPuzzle.eval_drop_cp / 100).toFixed(1)} pawns).`,
    });
  }, [currentPuzzle]);

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (filteredIndex < filteredPuzzles.length - 1) {
      setFilteredIndex((prev) => prev + 1);
    }
  }, [filteredIndex, filteredPuzzles.length]);

  const handlePrev = useCallback(() => {
    if (filteredIndex > 0) {
      setFilteredIndex((prev) => prev - 1);
    }
  }, [filteredIndex]);

  const handleRandom = useCallback(() => {
    if (filteredPuzzles.length === 0) return;
    const rand = Math.floor(Math.random() * filteredPuzzles.length);
    setFilteredIndex(rand);
  }, [filteredPuzzles.length]);

  const handleFlip = useCallback(() => {
    setOrientation((prev) => (prev === 'white' ? 'black' : 'white'));
  }, []);

  const handleSoundToggle = useCallback(() => {
    const next = sounds.toggle();
    setSoundEnabled(next);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea', 'select'].includes((e.target as HTMLElement).tagName.toLowerCase())) {
        return;
      }

      if (e.key === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key.toLowerCase() === 'h') {
        handleHint();
      } else if (e.key.toLowerCase() === 's') {
        handleRevealSolution();
      } else if (e.key.toLowerCase() === 'b') {
        handleShowGameBlunder();
      } else if (e.key.toLowerCase() === 'f') {
        handleFlip();
      } else if (e.key.toLowerCase() === 'm') {
        handleSoundToggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, handleHint, handleRevealSolution, handleShowGameBlunder, handleFlip, handleSoundToggle]);

  // Import custom puzzles JSON
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : parsed.puzzles;
        if (Array.isArray(list) && list.length > 0) {
          setAllPuzzles(list);
          setFilteredIndex(0);
          alert(`Successfully loaded ${list.length} puzzles!`);
        }
      } catch (err) {
        alert('Failed to parse puzzle JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const isCurrentSolved = solvedIds.has(currentPuzzle?.id || '');

  return (
    <div className="min-h-screen bg-[#161512] text-[#bababa] font-sans antialiased flex flex-col selection:bg-amber-500 selection:text-black">
      {/* Top Lichess-style Navbar */}
      <header className="h-14 bg-[#1e1c18] border-b border-[#2d2b25] px-4 md:px-6 flex items-center justify-between shadow-md z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-600 to-amber-500 flex items-center justify-center text-xl text-black shadow-md font-bold">
            ♟
          </div>
          <div>
            <h1 className="text-base md:text-lg font-bold text-white tracking-wide flex items-center gap-2">
              <span>ShohanTraining</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono font-semibold">
                Stockfish 17
              </span>
            </h1>
          </div>
        </div>

        {/* Stats & Quick Actions */}
        <div className="flex items-center gap-2 md:gap-3 text-xs">
          <div className="hidden sm:flex items-center gap-2 bg-[#161512] border border-[#2d2b25] px-2.5 py-1 rounded-lg">
            <span className="text-emerald-400 font-bold">{solvedIds.size}</span>
            <span className="text-[#7e7b73]">/ {allPuzzles.length} Solved</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#161512] border border-[#2d2b25] px-2.5 py-1 rounded-lg">
            <span className="text-rose-400 font-bold">🔥 {streak}</span>
            <span className="hidden sm:inline text-[#7e7b73]">Streak</span>
          </div>

          <button
            onClick={handleSoundToggle}
            className="p-1.5 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white border border-[#38352e] transition"
            title={soundEnabled ? 'Mute Sounds (M)' : 'Unmute Sounds (M)'}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>

          <button
            onClick={handleRandom}
            className="p-1.5 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white border border-[#38352e] transition"
            title="Random Puzzle"
          >
            🎲
          </button>

          <button
            onClick={() => setIsDrawerOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold transition shadow-sm flex items-center gap-1.5 text-xs"
          >
            <span>☰</span>
            <span className="hidden sm:inline">Browse ({filteredPuzzles.length})</span>
          </button>
        </div>
      </header>

      {/* Main Content Arena */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Side: Board & Eval Bar */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full max-w-[530px] space-y-3">
            {/* Opponent Info Header */}
            <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-xl px-3.5 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    currentPuzzle.player_color === 'white' ? 'bg-black border border-white' : 'bg-white'
                  }`}
                />
                <span className="text-white font-semibold truncate">
                  vs {currentPuzzle.opponent}
                </span>
                <span className="text-[#888] font-mono">({currentPuzzle.opponent_rating})</span>
              </div>

              <a
                href={currentPuzzle.game_url}
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:text-amber-300 underline font-mono text-[11px] shrink-0"
              >
                Chess.com ↗
              </a>
            </div>

            {/* Board Container with Eval Bar */}
            <div className="flex gap-2.5 items-stretch justify-center">
              {/* Lichess Vertical Eval Bar */}
              <EvalBar
                scoreText={currentPuzzle.eval_before}
                orientation={orientation}
                className="shrink-0"
              />

              {/* Lichess Board (Chessground) */}
              <div className="flex-1 max-w-[490px]">
                <LichessBoard
                  fen={boardFen}
                  orientation={orientation}
                  turnColor={currentPuzzle.player_color}
                  dests={dests}
                  lastMove={lastMove}
                  shapes={shapes}
                  viewOnly={viewOnly}
                  onMove={handleMove}
                />
              </div>
            </div>

            {/* Shohan Profile Bar (Bottom of board) */}
            <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-xl px-3.5 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    currentPuzzle.player_color === 'white' ? 'bg-white' : 'bg-black border border-white'
                  }`}
                />
                <span className="text-white font-semibold">ShohanTheRock</span>
                <span className="text-amber-400 font-mono font-medium">({currentPuzzle.player_rating || 2280})</span>
              </div>
              <span className="text-[#7e7b73] font-mono text-[11px]">
                Move {currentPuzzle.move_number}
              </span>
            </div>

            {/* Feedback & Interaction Status Banner */}
            <div
              className={`min-h-[46px] rounded-xl p-3 flex items-center justify-between text-xs font-medium border transition-all duration-200 ${
                feedback.type === 'solved'
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-200 shadow-lg shadow-emerald-950/40'
                  : feedback.type === 'blunder'
                  ? 'bg-rose-950/80 border-rose-500/60 text-rose-200 shadow-lg shadow-rose-950/40'
                  : feedback.type === 'error'
                  ? 'bg-rose-950/50 border-rose-600/40 text-rose-300'
                  : feedback.type === 'hint'
                  ? 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                  : 'bg-[#1e1c18] border-[#2d2b25] text-slate-300'
              }`}
            >
              <span className="leading-snug">{feedback.message}</span>
              <span className="font-mono text-[11px] text-amber-400 shrink-0 ml-2">
                {currentPuzzle.eval_before}
              </span>
            </div>

            {/* Tactical Controls (Next, Hint, Blunder, Solution) */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              <button
                onClick={handlePrev}
                disabled={filteredIndex === 0}
                className="bg-[#24221d] hover:bg-[#2e2b25] disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-semibold py-2.5 rounded-xl border border-[#38352e] transition active:scale-95 flex items-center justify-center gap-1"
                title="Previous Puzzle (Left Arrow)"
              >
                ◀ Prev
              </button>

              <button
                onClick={handleHint}
                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold py-2.5 rounded-xl border border-amber-500/30 transition active:scale-95 flex items-center justify-center gap-1"
                title="Tactical Hint (H)"
              >
                💡 Hint
              </button>

              <button
                onClick={handleShowGameBlunder}
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold py-2.5 rounded-xl border border-rose-500/30 transition active:scale-95 flex items-center justify-center gap-1"
                title="Show Game Move (B)"
              >
                ⏪ Game Move
              </button>

              <button
                onClick={handleNext}
                disabled={filteredIndex >= filteredPuzzles.length - 1}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold py-2.5 rounded-xl shadow-lg shadow-emerald-700/20 transition active:scale-95 flex items-center justify-center gap-1"
                title="Next Puzzle (Space or Right Arrow)"
              >
                Next ▶
              </button>
            </div>

            {/* Secondary actions */}
            <div className="flex items-center justify-between text-xs px-1 text-[#7e7b73]">
              <button
                onClick={handleRevealSolution}
                className="hover:text-amber-400 underline transition"
                title="Reveal Stockfish Solution (S)"
              >
                Reveal Engine Solution
              </button>

              <button
                onClick={handleFlip}
                className="hover:text-white transition flex items-center gap-1"
                title="Flip Board (F)"
              >
                🔄 Flip Orientation
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Tactical Breakdown & Coaching */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card: Current Puzzle Overview */}
          <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🎯</span>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Tactical Breakdown
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                {isCurrentSolved && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                    ✓ Solved
                  </span>
                )}
                <span className="font-mono text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                  #{filteredIndex + 1} of {filteredPuzzles.length}
                </span>
              </div>
            </div>

            {/* Comparison Metrics */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center bg-[#161512] px-3 py-2 rounded-xl border border-[#2d2b25]">
                <span className="text-[#7e7b73]">Opening:</span>
                <span className="font-semibold text-white text-right">
                  {currentPuzzle.opening_name} ({currentPuzzle.opening_eco})
                </span>
              </div>

              <div className="flex justify-between items-center bg-[#161512] px-3 py-2 rounded-xl border border-[#2d2b25]">
                <span className="text-[#7e7b73]">Tactical Theme:</span>
                <span className="font-bold text-amber-400 text-right">
                  {currentPuzzle.primary_theme}
                </span>
              </div>

              <div className="flex justify-between items-center bg-[#161512] px-3 py-2 rounded-xl border border-[#2d2b25]">
                <span className="text-rose-400 font-medium">In Game You Played:</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-rose-300">
                    {currentPuzzle.played_move_san}
                  </span>
                  <span className="text-[10px] text-rose-400/80 ml-1.5 font-mono">
                    (-{(currentPuzzle.eval_drop_cp / 100).toFixed(1)})
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center bg-[#161512] px-3 py-2 rounded-xl border border-[#2d2b25]">
                <span className="text-emerald-400 font-medium">Stockfish Solution:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {isCurrentSolved || viewOnly ? currentPuzzle.best_move_san : '??? (Hidden)'}
                </span>
              </div>
            </div>

            {/* Coach's Analysis & Explanation */}
            <div className="bg-[#161512] border border-[#2d2b25] rounded-xl p-3.5 space-y-2 text-xs leading-relaxed">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <span>🧠</span> Coach's Strategy:
              </div>
              <p className="text-slate-300">{currentPuzzle.explanation}</p>

              {(isCurrentSolved || viewOnly) && (
                <div className="pt-2 border-t border-[#2d2b25] font-mono text-[11px] text-emerald-400">
                  <span className="text-[#7e7b73] block mb-0.5 font-sans">Engine Line:</span>
                  {currentPuzzle.continuation_str}
                </div>
              )}
            </div>

            {/* Keyboard Shortcuts Bar */}
            <div className="pt-1 flex items-center justify-between text-[11px] text-[#6b675e] border-t border-[#2d2b25]">
              <span>Shortcuts:</span>
              <div className="flex gap-2 font-mono">
                <span>[Space] Next</span>
                <span>[H] Hint</span>
                <span>[S] Solution</span>
                <span>[F] Flip</span>
              </div>
            </div>
          </div>

          {/* Quick Filter Tags */}
          <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-2xl p-4 shadow-xl space-y-2.5">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Quick Theme Filters
            </h3>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {[
                { label: 'All', value: 'all' },
                { label: '💥 Knockouts', value: 'Knockout' },
                { label: '👑 Mates', value: 'Mate' },
                { label: '🛡️ Defenses', value: 'Defense' },
                { label: '🔱 Forks', value: 'Fork' },
                { label: '📌 Pins', value: 'Pin' },
                { label: '⚡ Discovered', value: 'Discovered' },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => {
                    setThemeFilter(t.value);
                    setFilteredIndex(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-xs transition ${
                    themeFilter === t.value
                      ? 'bg-amber-500 text-black font-bold border-amber-500'
                      : 'bg-[#161512] text-[#888] border-[#2d2b25] hover:text-white hover:border-[#3d3a33]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Drawer / Modal: Browse All Puzzles */}
      {isDrawerOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-md bg-[#1e1c18] border-l border-[#2d2b25] h-full flex flex-col shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>📚</span> All Missed Puzzles ({filteredPuzzles.length})
              </h2>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white flex items-center justify-center border border-[#38352e]"
              >
                ✕
              </button>
            </div>

            {/* Filter Controls in Drawer */}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search opponent or opening..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161512] border border-[#2d2b25] rounded-xl px-3 py-2 text-xs text-white placeholder-[#6b675e] focus:outline-none focus:border-amber-500"
              />

              <div className="grid grid-cols-2 gap-2 text-xs">
                <select
                  value={colorFilter}
                  onChange={(e) => setColorFilter(e.target.value as 'all' | 'white' | 'black')}
                  className="bg-[#161512] border border-[#2d2b25] rounded-xl px-2.5 py-1.5 text-white focus:outline-none"
                >
                  <option value="all">Both Colors</option>
                  <option value="white">As White</option>
                  <option value="black">As Black</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'unsolved' | 'solved')}
                  className="bg-[#161512] border border-[#2d2b25] rounded-xl px-2.5 py-1.5 text-white focus:outline-none"
                >
                  <option value="all">All Puzzles</option>
                  <option value="unsolved">Unsolved Only</option>
                  <option value="solved">Solved Only</option>
                </select>
              </div>
            </div>

            {/* Scrollable list of cards */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredPuzzles.map((p, idx) => {
                const isSolved = solvedIds.has(p.id);
                const isSelected = idx === filteredIndex;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setFilteredIndex(idx);
                      setIsDrawerOpen(false);
                    }}
                    className={`p-2.5 rounded-xl text-xs cursor-pointer border transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#2a2721] border-amber-500/60'
                        : 'bg-[#161512] border-[#2d2b25] hover:border-[#3d3a33] hover:bg-[#201e19]'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isSolved ? 'bg-emerald-400' : 'bg-[#444]'
                        }`}
                      />
                      <span className="font-mono text-[#7e7b73]">#{idx + 1}</span>
                      <div className="truncate">
                        <div className="text-white font-medium truncate">
                          {p.primary_theme}
                        </div>
                        <div className="text-[11px] text-[#7e7b73] truncate">
                          vs {p.opponent} ({p.opponent_rating}) • {p.opening_name}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 font-mono text-[11px]">
                      <span className="text-rose-400 font-semibold block">
                        -{(p.eval_drop_cp / 100).toFixed(1)}
                      </span>
                      <span className="text-[#666] text-[10px]">{p.turn}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Import / Reset */}
            <div className="pt-2 border-t border-[#2d2b25] flex justify-between items-center text-xs text-[#7e7b73]">
              <label className="text-amber-400 hover:text-amber-300 underline cursor-pointer">
                Import JSON
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => {
                  if (confirm('Reset solved puzzle progress and streak?')) {
                    setSolvedIds(new Set());
                    setStreak(0);
                    localStorage.removeItem('shohan_training_solved');
                    localStorage.removeItem('shohan_training_streak');
                  }
                }}
                className="hover:text-rose-400 transition"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingApp;
