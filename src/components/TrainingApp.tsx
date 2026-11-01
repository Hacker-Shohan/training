import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { Key } from 'chessground/types';
import { DrawShape } from 'chessground/draw';
import { LichessBoard } from './LichessBoard';
import { EvalBar } from './EvalBar';
import { sounds } from '../utils/sound';
import { browserEngine, EngineEvaluation } from '../utils/engine';
import type { ChessPuzzle, PuzzleSet } from '../types';
import defaultPuzzlesData from '../data/puzzles.json';

// Convert chess.js instance to chessground dests map
function toDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    chess.moves({ verbose: true }).forEach((m) => {
      const from = m.from as Key;
      const to = m.to as Key;
      const ms = dests.get(from);
      if (ms) ms.push(to);
      else dests.set(from, [to]);
    });
  } catch (e) {
    console.warn('toDests error:', e);
  }
  return dests;
}

interface DatabasePayload {
  version?: string;
  trainer_name?: string;
  total_sets?: number;
  sets?: PuzzleSet[];
  puzzles?: ChessPuzzle[];
}

const db = defaultPuzzlesData as unknown as DatabasePayload;
const allSets: PuzzleSet[] = (db.sets && db.sets.length > 0)
  ? db.sets
  : [
      {
        id: 'shohan-master',
        title: 'Shohan: Master Blunders',
        subtitle: '120 critical tactical misses (~2280 Rapid)',
        icon: '🎯',
        badge: '120 Puzzles',
        puzzles: db.puzzles || [],
      },
    ];

const initialSet = allSets[0];
const initialPuzzle = initialSet.puzzles[0];

export const TrainingApp: React.FC = () => {
  // Engine loading screen state
  const [engineLoading, setEngineLoading] = useState<boolean>(true);
  const [engineProgress, setEngineProgress] = useState<number>(15);

  // Active Puzzle Set selection
  const [currentSetId, setCurrentSetId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('thetrainer_active_set');
      if (saved && allSets.some((s) => s.id === saved)) return saved;
    } catch {}
    return initialSet.id;
  });
  const [isSetMenuOpen, setIsSetMenuOpen] = useState<boolean>(false);

  const currentSet = useMemo(() => {
    return allSets.find((s) => s.id === currentSetId) || allSets[0];
  }, [currentSetId]);

  const allPuzzles = currentSet.puzzles;

  // Solved IDs from localStorage
  const [solvedIds, setSolvedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('thetrainer_solved_puzzles');
      if (saved) return new Set(JSON.parse(saved));
      const legacy = localStorage.getItem('shohan_training_solved');
      return legacy ? new Set(JSON.parse(legacy)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Streak
  const [streak, setStreak] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('thetrainer_streak');
      if (saved) return parseInt(saved, 10);
      const legacy = localStorage.getItem('shohan_training_streak');
      return legacy ? parseInt(legacy, 10) : 0;
    } catch {
      return 0;
    }
  });

  // Settings
  const [soundEnabled, setSoundEnabled] = useState<boolean>(sounds.enabled);
  const [engineEnabled, setEngineEnabled] = useState<boolean>(true);

  // Filters
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [colorFilter, setColorFilter] = useState<'all' | 'white' | 'black'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unsolved' | 'solved'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Filtered puzzle list in active set
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
  const currentPuzzle = filteredPuzzles[filteredIndex] || allPuzzles[0] || initialPuzzle;

  // Board & Chess State
  const [chess, setChess] = useState<Chess>(() => {
    try {
      return new Chess(currentPuzzle?.fen);
    } catch {
      return new Chess();
    }
  });
  const [boardFen, setBoardFen] = useState<string>(() => currentPuzzle?.fen || '');
  const [orientation, setOrientation] = useState<'white' | 'black'>(() => currentPuzzle?.player_color || 'white');
  const [dests, setDests] = useState<Map<Key, Key[]>>(() => {
    try {
      return toDests(new Chess(currentPuzzle?.fen));
    } catch {
      return new Map();
    }
  });
  const [lastMove, setLastMove] = useState<Key[]>([]);
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [viewOnly, setViewOnly] = useState<boolean>(false);
  const [boardRevision, setBoardRevision] = useState<number>(0);

  // Move tracking (Lichess style - only records moves as they are played)
  const [playedMoves, setPlayedMoves] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const isAutoPlayingRef = useRef<boolean>(false);

  // Live browser engine evaluation
  const [liveEval, setLiveEval] = useState<EngineEvaluation | null>(null);

  // Lichess Status state
  const [statusText, setStatusText] = useState<{
    type: 'turn' | 'success' | 'solved' | 'blunder' | 'error' | 'hint';
    title: string;
    subtitle?: string;
  }>({
    type: 'turn',
    title: 'Your turn',
    subtitle: `Find the best move for ${currentPuzzle?.turn || 'White'}!`,
  });

  // Simulated Engine Download & Init Screen
  useEffect(() => {
    const timer1 = setTimeout(() => setEngineProgress(45), 250);
    const timer2 = setTimeout(() => setEngineProgress(85), 600);
    const timer3 = setTimeout(() => {
      setEngineProgress(100);
      setTimeout(() => setEngineLoading(false), 300);
    }, 900);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  // Force snapback helper
  const forceResetBoard = useCallback(() => {
    setBoardRevision((r) => r + 1);
  }, []);

  // Switch Active Puzzle Set
  const handleSelectSet = useCallback((setId: string) => {
    setCurrentSetId(setId);
    setFilteredIndex(0);
    setThemeFilter('all');
    setColorFilter('all');
    setStatusFilter('all');
    setSearchQuery('');
    setIsSetMenuOpen(false);
    try {
      localStorage.setItem('thetrainer_active_set', setId);
    } catch {}
  }, []);

  // Load / Reset Puzzle
  const loadPuzzle = useCallback(
    (puzzle: ChessPuzzle) => {
      if (!puzzle) return;
      isAutoPlayingRef.current = false;
      try {
        const newChess = new Chess(puzzle.fen);
        setChess(newChess);
        setBoardFen(newChess.fen());
        setOrientation(puzzle.player_color);
        setDests(toDests(newChess));
        setLastMove([]);
        setShapes([]);
        setViewOnly(false);
        setPlayedMoves([]);
        setIsCompleted(false);
        setBoardRevision((r) => r + 1);

        setStatusText({
          type: 'turn',
          title: 'Your turn',
          subtitle: `Find the best move for ${puzzle.turn}!`,
        });

        // Trigger browser engine evaluation if enabled
        if (engineEnabled) {
          browserEngine.evaluate(newChess.fen(), 12, (ev) => {
            setLiveEval(ev);
          });
        }
      } catch (err) {
        console.error('Failed to load puzzle FEN:', puzzle.fen, err);
      }
    },
    [engineEnabled]
  );

  useEffect(() => {
    if (currentPuzzle) {
      loadPuzzle(currentPuzzle);
    }
  }, [currentPuzzle, loadPuzzle]);

  // When board FEN changes, update live engine
  useEffect(() => {
    if (engineEnabled && boardFen) {
      browserEngine.evaluate(boardFen, 12, (ev) => {
        setLiveEval(ev);
      });
    }
  }, [boardFen, engineEnabled]);

  // Handle Mark Solved
  const onPuzzleComplete = useCallback(() => {
    sounds.playSuccess();
    setIsCompleted(true);
    setViewOnly(false);

    setSolvedIds((prev) => {
      const next = new Set(prev).add(currentPuzzle.id);
      localStorage.setItem('thetrainer_solved_puzzles', JSON.stringify([...next]));
      return next;
    });

    setStreak((prev) => {
      const next = prev + 1;
      localStorage.setItem('thetrainer_streak', String(next));
      return next;
    });

    setStatusText({
      type: 'solved',
      title: 'Puzzle Solved!',
      subtitle: `Victory! Decisive advantage achieved (${currentPuzzle.eval_before}).`,
    });
  }, [currentPuzzle]);

  // Handle User Move on Board
  const handleMove = useCallback(
    (orig: Key, dest: Key) => {
      if (viewOnly || isAutoPlayingRef.current) return;

      const tempChess = new Chess(chess.fen());
      let move: any = null;
      try {
        move = tempChess.move({ from: orig, to: dest, promotion: 'q' });
      } catch {
        move = null;
      }

      if (!move) {
        forceResetBoard();
        return;
      }

      // If already solved, allow free exploratory moves on board
      if (isCompleted) {
        if (move.captured) sounds.playCapture();
        else sounds.playMove();
        if (tempChess.isCheck()) setTimeout(() => sounds.playCheck(), 100);

        setChess(tempChess);
        setBoardFen(tempChess.fen());
        setLastMove([orig, dest]);
        setDests(toDests(tempChess));
        setPlayedMoves((prev) => [...prev, move.san]);
        return;
      }

      const continuation = currentPuzzle.continuation_san || [];
      const currentPly = playedMoves.length;
      const expectedSan = continuation[currentPly] || currentPuzzle.best_move_san;
      const expectedUci = currentPuzzle.best_move_uci;
      const playedUci = orig + dest;

      const cleanSan = (s: string) => (s ? s.replace(/[+#x=]/g, '') : '');
      const isSanMatch =
        move.san === expectedSan || cleanSan(move.san) === cleanSan(expectedSan);
      const isUciMatch =
        currentPly === 0 &&
        (playedUci === expectedUci.slice(0, 4) || playedUci === expectedUci);

      // Check if user played their actual game blunder
      const isGameBlunder =
        currentPly === 0 &&
        (move.san === currentPuzzle.played_move_san ||
          playedUci === currentPuzzle.played_move_uci.slice(0, 4) ||
          cleanSan(move.san) === cleanSan(currentPuzzle.played_move_san));

      if (isSanMatch || isUciMatch) {
        // --- 1. CORRECT USER MOVE ---
        if (move.captured) sounds.playCapture();
        else sounds.playMove();

        if (tempChess.isCheck()) {
          setTimeout(() => sounds.playCheck(), 100);
        }

        const nextMoves = [...playedMoves, move.san];
        setPlayedMoves(nextMoves);
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

        const lastUserPly =
          continuation.length > 0
            ? continuation.length % 2 === 0
              ? continuation.length - 2
              : continuation.length - 1
            : 0;

        if (tempChess.isGameOver() || currentPly >= lastUserPly) {
          onPuzzleComplete();
          return;
        }

        // --- 2. OPPONENT AUTO-REPLY ---
        const oppReplySan = continuation[nextMoves.length];
        if (oppReplySan) {
          setViewOnly(true);
          setStatusText({
            type: 'success',
            title: 'Best move!',
            subtitle: 'Opponent replying...',
          });

          setTimeout(() => {
            try {
              const oppChess = new Chess(tempChess.fen());
              const oppMove = oppChess.move(oppReplySan);
              if (oppMove) {
                if (oppMove.captured) sounds.playCapture();
                else sounds.playMove();

                if (oppChess.isCheck()) {
                  setTimeout(() => sounds.playCheck(), 100);
                }

                const postOppMoves = [...nextMoves, oppMove.san];
                setPlayedMoves(postOppMoves);
                setChess(oppChess);
                setBoardFen(oppChess.fen());
                setLastMove([oppMove.from as Key, oppMove.to as Key]);
                setDests(toDests(oppChess));
                setViewOnly(false);

                if (oppChess.isGameOver()) {
                  onPuzzleComplete();
                  return;
                }

                if (postOppMoves.length >= continuation.length) {
                  onPuzzleComplete();
                } else {
                  setStatusText({
                    type: 'turn',
                    title: 'Your turn',
                    subtitle: 'Find the follow-up blow!',
                  });
                }
              } else {
                onPuzzleComplete();
              }
            } catch (err) {
              console.warn('Opponent auto-move error:', err);
              onPuzzleComplete();
            }
          }, 350);
        } else {
          onPuzzleComplete();
        }
      } else if (isGameBlunder) {
        // --- 3. PLAYED GAME BLUNDER ---
        sounds.playError();
        setStreak(0);
        localStorage.setItem('thetrainer_streak', '0');

        setShapes([
          {
            orig,
            dest,
            brush: 'red',
          },
        ]);
        setStatusText({
          type: 'blunder',
          title: `Game Blunder (${move.san})!`,
          subtitle: `That's what was played in the game! Eval crashed from ${currentPuzzle.eval_before} to ${currentPuzzle.eval_after_played}.`,
        });

        setTimeout(() => {
          forceResetBoard();
        }, 350);
      } else {
        // --- 4. INCORRECT MOVE ---
        sounds.playError();
        setStreak(0);
        localStorage.setItem('thetrainer_streak', '0');

        setShapes([
          {
            orig,
            dest,
            brush: 'red',
          },
        ]);
        setStatusText({
          type: 'error',
          title: 'Not the move.',
          subtitle: 'That is not the winning continuation. Try again!',
        });

        setTimeout(() => {
          forceResetBoard();
        }, 350);
      }
    },
    [chess, currentPuzzle, playedMoves, viewOnly, isCompleted, onPuzzleComplete, forceResetBoard]
  );

  // Auto-play solution sequence
  const handleAutoPlaySolution = useCallback(() => {
    if (isAutoPlayingRef.current) return;
    isAutoPlayingRef.current = true;
    setViewOnly(true);

    const continuation = currentPuzzle.continuation_san || [];
    let currentC = new Chess(currentPuzzle.fen);
    let step = 0;
    const movesList: string[] = [];

    const playNextStep = () => {
      if (!isAutoPlayingRef.current || step >= continuation.length) {
        isAutoPlayingRef.current = false;
        onPuzzleComplete();
        return;
      }

      const san = continuation[step];
      try {
        const m = currentC.move(san);
        if (m) {
          if (m.captured) sounds.playCapture();
          else sounds.playMove();
          if (currentC.isCheck()) setTimeout(() => sounds.playCheck(), 100);

          movesList.push(m.san);
          setPlayedMoves([...movesList]);
          setChess(new Chess(currentC.fen()));
          setBoardFen(currentC.fen());
          setLastMove([m.from as Key, m.to as Key]);
          setShapes([
            {
              orig: m.from as Key,
              dest: m.to as Key,
              brush: step % 2 === 0 ? 'green' : 'blue',
            },
          ]);

          step++;
          if (step < continuation.length && !currentC.isGameOver()) {
            setTimeout(playNextStep, 450);
          } else {
            isAutoPlayingRef.current = false;
            onPuzzleComplete();
          }
        }
      } catch {
        isAutoPlayingRef.current = false;
        onPuzzleComplete();
      }
    };

    playNextStep();
  }, [currentPuzzle, onPuzzleComplete]);

  // Hint button
  const handleHint = useCallback(() => {
    if (!currentPuzzle) return;
    const continuation = currentPuzzle.continuation_san || [];
    const targetSan = continuation[playedMoves.length] || currentPuzzle.best_move_san;

    const moves = chess.moves({ verbose: true });
    const targetMove = moves.find((m) => m.san === targetSan);

    if (targetMove) {
      setShapes([
        {
          orig: targetMove.from as Key,
          brush: 'yellow',
        },
      ]);
      setStatusText({
        type: 'hint',
        title: 'Tactical Hint',
        subtitle: `Focus on the piece on ${targetMove.from.toUpperCase()}! Theme: ${currentPuzzle.primary_theme}.`,
      });
    }
  }, [chess, currentPuzzle, playedMoves]);

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

    setStatusText({
      type: 'blunder',
      title: `Game Blunder (${currentPuzzle.played_move_san})`,
      subtitle: `Eval dropped from ${currentPuzzle.eval_before} to ${currentPuzzle.eval_after_played} (-${(currentPuzzle.eval_drop_cp / 100).toFixed(1)} pawns).`,
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

  const handleEngineToggle = useCallback(() => {
    setEngineEnabled((prev) => {
      const next = !prev;
      if (!next) {
        browserEngine.stop();
        setLiveEval(null);
      } else {
        browserEngine.evaluate(boardFen, 12, (ev) => setLiveEval(ev));
      }
      return next;
    });
  }, [boardFen]);

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
        handleAutoPlaySolution();
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
  }, [handleNext, handlePrev, handleHint, handleAutoPlaySolution, handleShowGameBlunder, handleFlip, handleSoundToggle]);

  const isCurrentSolved = solvedIds.has(currentPuzzle?.id || '');
  const solvedCountInActiveSet = useMemo(() => {
    return allPuzzles.filter((p) => solvedIds.has(p.id)).length;
  }, [allPuzzles, solvedIds]);

  // Live arrow from browser engine if in analysis mode
  const combinedShapes = useMemo(() => {
    const list = [...shapes];
    if (engineEnabled && liveEval && liveEval.bestMove && isCompleted) {
      const orig = liveEval.bestMove.slice(0, 2) as Key;
      const dest = liveEval.bestMove.slice(2, 4) as Key;
      list.push({
        orig,
        dest,
        brush: 'blue',
      });
    }
    return list;
  }, [shapes, engineEnabled, liveEval, isCompleted]);

  return (
    <div className="min-h-screen bg-[#161512] text-[#bababa] font-sans antialiased flex flex-col selection:bg-amber-500 selection:text-black">
      {/* Engine Loading Screen */}
      {engineLoading && (
        <div className="fixed inset-0 bg-[#161512] z-50 flex flex-col items-center justify-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-3xl animate-bounce">
            ♟
          </div>
          <h2 className="text-xl font-black text-white tracking-wide">TheTrainer</h2>
          <p className="text-xs text-[#888]">Loading Stockfish Engine (WASM)...</p>
          <div className="w-56 h-1.5 bg-[#2d2b25] rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${engineProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <header className="bg-[#1e1c18] border-b border-[#2d2b25] px-4 py-2.5 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-black text-lg shadow-sm">
              ♞
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-white tracking-wide leading-none">
                TheTrainer
              </h1>
              <span className="text-[10px] text-amber-400/90 font-mono leading-none">
                Tactical Engine Lab
              </span>
            </div>
          </div>

          {/* Puzzle Set Selector Dropdown */}
          <div className="relative ml-2">
            <button
              onClick={() => setIsSetMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 bg-[#262420] hover:bg-[#322f2a] text-white px-3 py-1.5 rounded-xl border border-[#3d3a33] text-xs font-semibold shadow-sm transition active:scale-95"
              title="Switch Puzzle Set / Collection"
            >
              <span className="text-sm">{currentSet.icon}</span>
              <span className="font-bold hidden sm:inline">{currentSet.title}</span>
              <span className="sm:hidden font-bold">{currentSet.title.split(':')[0]}</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono border border-amber-500/30">
                {currentSet.puzzles.length}
              </span>
              <span className="text-[#888] text-[9px]">▼</span>
            </button>

            {isSetMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsSetMenuOpen(false)}
                />
                <div className="absolute left-0 mt-2 w-80 bg-[#1e1c18] border border-[#3d3a33] rounded-2xl shadow-2xl p-2 z-50 space-y-1 animate-fadeIn">
                  <div className="px-3 py-2 text-[10px] font-bold text-[#888] uppercase tracking-wider border-b border-[#2d2b25]">
                    Select Puzzle Set
                  </div>
                  {allSets.map((s) => {
                    const isSelected = s.id === currentSetId;
                    const solvedInThisSet = s.puzzles.filter((p) => solvedIds.has(p.id)).length;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handleSelectSet(s.id)}
                        className={`w-full text-left p-2.5 rounded-xl transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-[#2b2720] border border-amber-500/50 text-white'
                            : 'hover:bg-[#262420] text-[#ccc] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <span className="text-xl shrink-0">{s.icon}</span>
                          <div className="truncate">
                            <div className="font-bold text-xs text-white truncate">
                              {s.title}
                            </div>
                            <div className="text-[10px] text-[#888] truncate">
                              {s.subtitle}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2 font-mono text-[10px]">
                          <span className="text-amber-400 font-bold block">
                            {s.puzzles.length}
                          </span>
                          <span className="text-[#7e7b73]">
                            {solvedInThisSet} solved
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Header Stats & Controls */}
        <div className="flex items-center gap-2 text-xs">
          <div className="hidden sm:flex items-center gap-1.5 bg-[#161512] border border-[#2d2b25] px-2.5 py-1 rounded-lg">
            <span className="text-emerald-400 font-bold">{solvedCountInActiveSet}</span>
            <span className="text-[#7e7b73]">/ {allPuzzles.length} in Set</span>
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
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Board & Eval Bar */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full max-w-[530px] space-y-3">
            {/* Opponent Header */}
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

              <div className="flex items-center gap-2">
                {engineEnabled && liveEval && (
                  <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    Depth {liveEval.depth}: {liveEval.score}
                  </span>
                )}
                {currentPuzzle.game_url && (
                  <a
                    href={currentPuzzle.game_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline font-mono text-[11px] shrink-0"
                  >
                    Source ↗
                  </a>
                )}
              </div>
            </div>

            {/* Board Container with Eval Bar */}
            <div className="flex gap-2.5 items-stretch justify-center">
              <EvalBar
                scoreText={engineEnabled && liveEval ? liveEval.score : currentPuzzle.eval_before}
                orientation={orientation}
                className="shrink-0"
              />

              <div className="flex-1 max-w-[490px]">
                <LichessBoard
                  fen={boardFen}
                  orientation={orientation}
                  turnColor={currentPuzzle.player_color}
                  dests={dests}
                  lastMove={lastMove}
                  shapes={combinedShapes}
                  viewOnly={viewOnly}
                  onMove={handleMove}
                  revision={boardRevision}
                />
              </div>
            </div>

            {/* Player Bottom Bar */}
            <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-xl px-3.5 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    currentPuzzle.player_color === 'white' ? 'bg-white' : 'bg-black border border-white'
                  }`}
                />
                <span className="text-white font-semibold">
                  {currentSetId === 'world-champions' ? (currentPuzzle.id === 'classic-001' ? 'Paul Morphy' : currentPuzzle.id === 'classic-002' ? 'Edward Lasker' : currentPuzzle.id === 'classic-003' ? 'Adolf Anderssen' : currentPuzzle.id === 'classic-004' ? 'Frank Marshall' : currentPuzzle.id === 'classic-005' ? 'Bobby Fischer' : currentPuzzle.id === 'classic-006' ? 'Garry Kasparov' : 'Mikhail Botvinnik') : 'ShohanTheRock'}
                </span>
                <span className="text-amber-400 font-mono font-medium">
                  ({currentPuzzle.player_rating || 2280})
                </span>
              </div>
              <span className="text-[#7e7b73] font-mono text-[11px]">
                Move {currentPuzzle.move_number}
              </span>
            </div>

            {/* Tactical Controls */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              <button
                onClick={handlePrev}
                disabled={filteredIndex === 0}
                className="bg-[#24221d] hover:bg-[#2e2b25] disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-semibold py-2.5 rounded-xl border border-[#38352e] transition active:scale-95 flex items-center justify-center gap-1"
                title="Previous Puzzle"
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
                title="Show What Was Played in Game (B)"
              >
                ⏪ Game Move
              </button>

              <button
                onClick={handleNext}
                disabled={filteredIndex >= filteredPuzzles.length - 1}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold py-2.5 rounded-xl shadow-lg shadow-emerald-700/20 transition active:scale-95 flex items-center justify-center gap-1"
                title="Next Puzzle"
              >
                Next ▶
              </button>
            </div>

            {/* Secondary actions */}
            <div className="flex items-center justify-between text-xs px-1 text-[#7e7b73]">
              <button
                onClick={handleAutoPlaySolution}
                className="hover:text-amber-400 underline transition flex items-center gap-1"
                title="Watch engine auto-play solution till conclusion (S)"
              >
                <span>▶ Auto-Play Solution</span>
              </button>

              <button
                onClick={() => loadPuzzle(currentPuzzle)}
                className="hover:text-white transition"
                title="Restart this position"
              >
                🔄 Reset
              </button>

              <button
                onClick={handleFlip}
                className="hover:text-white transition flex items-center gap-1"
                title="Flip Board (F)"
              >
                🔄 Flip Board
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Authentic Lichess Puzzle Status & Notation */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-2xl p-5 shadow-xl space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <div>
                <h2 className="text-base font-bold text-white tracking-wide">
                  Puzzle #{filteredIndex + 1}
                </h2>
                <p className="text-xs text-[#888]">
                  {currentPuzzle.opening_name} ({currentPuzzle.opening_eco})
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {isCurrentSolved && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                    ✓ Solved
                  </span>
                )}
                <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded font-mono border border-amber-500/20">
                  {currentPuzzle.primary_theme}
                </span>
              </div>
            </div>

            {/* Big Lichess Status Banner */}
            <div
              className={`p-4 rounded-xl border text-center space-y-1 transition-all ${
                statusText.type === 'solved'
                  ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-200'
                  : statusText.type === 'blunder'
                  ? 'bg-rose-950/80 border-rose-500/60 text-rose-200'
                  : statusText.type === 'error'
                  ? 'bg-rose-950/60 border-rose-600/40 text-rose-300'
                  : statusText.type === 'hint'
                  ? 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                  : statusText.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#141310] border-[#2d2b25] text-white'
              }`}
            >
              <div className="text-base font-bold tracking-wide">{statusText.title}</div>
              {statusText.subtitle && (
                <div className="text-xs text-[#999] leading-snug">{statusText.subtitle}</div>
              )}
            </div>

            {/* Lichess Move History Notation (Only moves played so far!) */}
            <div className="bg-[#141310] border border-[#2d2b25] rounded-xl p-3 min-h-[140px] flex flex-col justify-between">
              <div className="text-[11px] text-[#7e7b73] uppercase font-semibold tracking-wider flex justify-between border-b border-[#2d2b25] pb-2 mb-2">
                <span>Move Notation</span>
                <span className="font-mono text-emerald-400 text-[10px]">
                  {isCompleted ? 'Clear Conclusion Reached' : `${playedMoves.length} moves played`}
                </span>
              </div>

              <div className="font-mono text-xs flex-1">
                {playedMoves.length === 0 ? (
                  <div className="text-[#555] italic text-center py-6">
                    Play the winning move on the board...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {playedMoves.map((m, idx) => {
                      const isUser = idx % 2 === 0;
                      return (
                        <span
                          key={idx}
                          className={`px-2 py-1 rounded ${
                            isUser
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {idx + 1}. {m} {isUser ? '👤' : '🤖'}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Post-Puzzle Analysis (Unlocked only after completion!) */}
            {isCompleted && (
              <div className="bg-[#141310] border border-emerald-500/30 rounded-xl p-3.5 space-y-2 text-xs animate-fadeIn">
                <div className="font-semibold text-emerald-400 flex items-center justify-between">
                  <span>🧠 Post-Game Analysis</span>
                  <span className="font-mono text-[10px] text-[#888]">
                    In game: {currentPuzzle.played_move_san} (-{(currentPuzzle.eval_drop_cp / 100).toFixed(1)})
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">{currentPuzzle.explanation}</p>
                <div className="pt-2 border-t border-[#2d2b25] font-mono text-[11px] text-emerald-300">
                  <span className="text-[#666] block font-sans text-[10px]">Full Continuation:</span>
                  {currentPuzzle.continuation_str}
                </div>
              </div>
            )}

            {/* Quick Next Button When Solved */}
            {isCompleted && (
              <button
                onClick={handleNext}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl shadow-lg transition active:scale-95 text-xs flex items-center justify-center gap-1.5"
              >
                <span>Next Puzzle</span>
                <span>▶</span>
              </button>
            )}

            {/* Keyboard Shortcuts */}
            <div className="pt-1 flex items-center justify-between text-[11px] text-[#6b675e] border-t border-[#2d2b25]">
              <span>Shortcuts:</span>
              <div className="flex gap-2 font-mono">
                <span>[Space] Next</span>
                <span>[H] Hint</span>
                <span>[S] Auto-Play</span>
                <span>[F] Flip</span>
              </div>
            </div>
          </div>

          {/* Quick Theme Filters */}
          <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-2xl p-4 shadow-xl space-y-2.5">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Filter by Theme in Active Set
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

      {/* Drawer: Browse All Puzzles in Current Set */}
      {isDrawerOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-md bg-[#1e1c18] border-l border-[#2d2b25] h-full flex flex-col shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>{currentSet.icon}</span> {currentSet.title}
                </h2>
                <span className="text-[11px] text-[#888]">
                  {filteredPuzzles.length} available puzzles
                </span>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white flex items-center justify-center border border-[#38352e]"
              >
                ✕
              </button>
            </div>

            {/* Quick Set Tabs inside Drawer */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
              {allSets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelectSet(s.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition flex items-center gap-1 ${
                    s.id === currentSetId
                      ? 'bg-amber-500 text-black font-bold'
                      : 'bg-[#161512] text-[#888] hover:text-white border border-[#2d2b25]'
                  }`}
                >
                  <span>{s.icon}</span>
                  <span>{s.title.split(':')[0]}</span>
                </button>
              ))}
            </div>

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

            <div className="pt-2 border-t border-[#2d2b25] flex justify-between items-center text-xs text-[#7e7b73]">
              <button
                onClick={() => {
                  if (confirm('Reset solved puzzle progress and streak?')) {
                    setSolvedIds(new Set());
                    setStreak(0);
                    localStorage.removeItem('thetrainer_solved_puzzles');
                    localStorage.removeItem('thetrainer_streak');
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
