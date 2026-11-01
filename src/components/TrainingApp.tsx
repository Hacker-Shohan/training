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
const allSets: PuzzleSet[] =
  db.sets && db.sets.length > 0
    ? db.sets
    : [
        {
          id: 'shohan-master',
          title: 'Healthy Mix',
          subtitle: 'Balanced tactical collection (120 Missed Blows)',
          icon: '🔀',
          badge: '120 Puzzles',
          puzzles: db.puzzles || [],
        },
      ];

// Group sets by player/database
interface PlayerDatabase {
  id: string;
  name: string;
  rating: string;
  icon: string;
  tag: string;
  description: string;
  available: boolean;
  setIds: string[];
}

const databases: PlayerDatabase[] = [
  {
    id: 'shohan',
    name: 'ShohanTheRock',
    rating: '~2280 Rapid',
    icon: '♟️',
    tag: '1,522 Games',
    description: 'Personal tactical oversights, knockout attacks & opening blunders.',
    available: true,
    setIds: ['shohan-master', 'shohan-mates', 'shohan-openings', 'shohan-defenses'],
  },
  {
    id: 'grandmasters',
    name: 'Immortal Grandmasters',
    rating: '2600 - 2850 Elo',
    icon: '🏆',
    tag: 'World Champions',
    description: 'Immortal historical combinations from Morphy, Fischer, Kasparov & Tal.',
    available: true,
    setIds: ['world-champions'],
  },
  {
    id: 'player2',
    name: 'Player 2',
    rating: 'Custom PGN',
    icon: '👤',
    tag: 'Coming Soon',
    description: 'Slot reserved for next player database upload.',
    available: false,
    setIds: [],
  },
  {
    id: 'player3',
    name: 'Player 3',
    rating: 'Custom PGN',
    icon: '👤',
    tag: 'Coming Soon',
    description: 'Slot reserved for next player database upload.',
    available: false,
    setIds: [],
  },
];

const initialSet = allSets[0];
const initialPuzzle = initialSet.puzzles[0];

export const TrainingApp: React.FC = () => {
  // Engine loading screen state
  const [engineLoading, setEngineLoading] = useState<boolean>(true);
  const [engineProgress, setEngineProgress] = useState<number>(15);

  // Active Database & Set Selection
  const [currentSetId, setCurrentSetId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('thetrainer_active_set');
      if (saved && allSets.some((s) => s.id === saved)) return saved;
    } catch {}
    return initialSet.id;
  });

  // Database Picker Modal State (Open on first visit)
  const [isDbModalOpen, setIsDbModalOpen] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('thetrainer_onboarded');
    } catch {
      return false;
    }
  });
  const [selectedPlayerForSubmenu, setSelectedPlayerForSubmenu] = useState<string | null>('shohan');

  const currentSet = useMemo(() => {
    return allSets.find((s) => s.id === currentSetId) || allSets[0];
  }, [currentSetId]);

  const allPuzzles = currentSet.puzzles;

  // Active Player Info
  const activePlayer = useMemo(() => {
    return databases.find((d) => d.setIds.includes(currentSetId)) || databases[0];
  }, [currentSetId]);

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
    setIsDbModalOpen(false);
    try {
      localStorage.setItem('thetrainer_active_set', setId);
      localStorage.setItem('thetrainer_onboarded', 'true');
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

    const isMate = currentPuzzle.eval_before.includes('M') || currentPuzzle.primary_theme.includes('Mate');
    setStatusText({
      type: 'solved',
      title: isMate ? 'Checkmate Delivered!' : 'Puzzle Solved!',
      subtitle: isMate
        ? 'Victory! Forced mating sequence completed to checkmate.'
        : `Victory! Decisive advantage achieved (${currentPuzzle.eval_before}).`,
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

        // Calculate the last user ply index
        const lastUserPly =
          continuation.length > 0
            ? continuation.length % 2 === 0
              ? continuation.length - 2
              : continuation.length - 1
            : 0;

        // Check if game is over (Checkmate delivered) or conclusion reached
        if (tempChess.isGameOver() || tempChess.isCheckmate() || currentPly >= lastUserPly) {
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

                if (oppChess.isGameOver() || oppChess.isCheckmate()) {
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
        <div className="fixed inset-0 bg-[#161512] z-50 flex flex-col items-center justify-center space-y-4 px-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-3xl animate-bounce">
            ♟
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">TheTrainer</h2>
          <p className="text-xs text-[#888]">Loading Stockfish WASM Engine...</p>
          <div className="w-48 sm:w-56 h-1.5 bg-[#2d2b25] rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${engineProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Top Navbar - Mobile Optimized */}
      <header className="bg-[#1e1c18] border-b border-[#2d2b25] px-2.5 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between sticky top-0 z-40 shadow-md">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-black text-base sm:text-lg shadow-sm shrink-0">
              ♞
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-wide leading-none">
                TheTrainer
              </h1>
              <span className="hidden sm:inline text-[9px] text-amber-400/90 font-mono leading-none">
                Tactical Engine Lab
              </span>
            </div>
          </div>

          {/* Database & Set Switcher Button */}
          <button
            onClick={() => setIsDbModalOpen(true)}
            className="flex items-center gap-1 sm:gap-2 bg-[#262420] hover:bg-[#322f2a] text-white px-2 sm:px-3 py-1.5 rounded-xl border border-[#3d3a33] text-[11px] sm:text-xs font-semibold shadow-sm transition active:scale-95"
            title="Switch Player Database or Training Collection"
          >
            <span className="text-xs sm:text-sm">{activePlayer.icon}</span>
            <span className="font-bold hidden md:inline">{activePlayer.name}:</span>
            <span className="font-bold text-amber-300 truncate max-w-[110px] sm:max-w-none">
              {currentSet.title}
            </span>
            <span className="text-[9px] sm:text-[10px] bg-amber-500/20 text-amber-300 px-1 py-0.5 rounded font-mono border border-amber-500/30">
              {currentSet.puzzles.length}
            </span>
            <span className="text-[#888] text-[8px] sm:text-[9px]">▼</span>
          </button>
        </div>

        {/* Header Stats & Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs">
          <div className="hidden lg:flex items-center gap-1.5 bg-[#161512] border border-[#2d2b25] px-2.5 py-1 rounded-lg">
            <span className="text-emerald-400 font-bold">{solvedCountInActiveSet}</span>
            <span className="text-[#7e7b73]">/ {allPuzzles.length}</span>
          </div>

          <div className="flex items-center gap-1 bg-[#161512] border border-[#2d2b25] px-2 py-1 rounded-lg text-xs">
            <span className="text-rose-400 font-bold">🔥 {streak}</span>
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
            className="hidden sm:inline-block p-1.5 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white border border-[#38352e] transition"
            title="Random Puzzle"
          >
            🎲
          </button>

          <button
            onClick={() => setIsDrawerOpen(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold transition shadow-sm flex items-center gap-1 text-[11px] sm:text-xs"
          >
            <span>☰</span>
            <span className="hidden sm:inline">Browse</span>
          </button>
        </div>
      </header>

      {/* Main Content Arena - 100% Mobile Friendly */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-2 sm:p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
        {/* Left Side: Board & Eval Bar */}
        <div className="lg:col-span-7 flex flex-col items-center w-full">
          <div className="w-full max-w-[490px] space-y-2 sm:space-y-3">
            {/* Opponent Top Bar */}
            <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                <span
                  className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
                    currentPuzzle.player_color === 'white' ? 'bg-black border border-white' : 'bg-white'
                  }`}
                />
                <span className="text-white font-semibold truncate text-[11px] sm:text-xs">
                  vs {currentPuzzle.opponent}
                </span>
                <span className="text-[#888] font-mono text-[10px] sm:text-xs">
                  ({currentPuzzle.opponent_rating})
                </span>
              </div>

              {/* Clean evaluation badge - NO depth clutter */}
              <div className="flex items-center gap-1.5">
                {engineEnabled && liveEval && (
                  <span className="font-mono text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                    {liveEval.score}
                  </span>
                )}
                {currentPuzzle.game_url && (
                  <a
                    href={currentPuzzle.game_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline font-mono text-[10px] shrink-0"
                  >
                    Game ↗
                  </a>
                )}
              </div>
            </div>

            {/* Board Container with Mobile-scaled Eval Bar */}
            <div className="flex gap-1.5 sm:gap-2.5 items-stretch justify-center w-full">
              <EvalBar
                scoreText={engineEnabled && liveEval ? liveEval.score : currentPuzzle.eval_before}
                orientation={orientation}
                className="shrink-0"
              />

              <div className="flex-1 w-full max-w-[460px]">
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
            <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span
                  className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
                    currentPuzzle.player_color === 'white' ? 'bg-white' : 'bg-black border border-white'
                  }`}
                />
                <span className="text-white font-semibold text-[11px] sm:text-xs">
                  {currentSetId === 'world-champions'
                    ? (currentPuzzle.id === 'classic-001'
                        ? 'Paul Morphy'
                        : currentPuzzle.id === 'classic-002'
                        ? 'Edward Lasker'
                        : currentPuzzle.id === 'classic-003'
                        ? 'Adolf Anderssen'
                        : currentPuzzle.id === 'classic-004'
                        ? 'Frank Marshall'
                        : currentPuzzle.id === 'classic-005'
                        ? 'Bobby Fischer'
                        : currentPuzzle.id === 'classic-006'
                        ? 'Mikhail Tal'
                        : currentPuzzle.id === 'classic-007'
                        ? 'Garry Kasparov'
                        : 'Mikhail Botvinnik')
                    : 'ShohanTheRock'}
                </span>
                <span className="text-amber-400 font-mono text-[10px] sm:text-xs font-medium">
                  ({currentPuzzle.player_rating || 2280})
                </span>
              </div>
              <span className="text-[#7e7b73] font-mono text-[10px] sm:text-[11px]">
                Move {currentPuzzle.move_number}
              </span>
            </div>

            {/* Tactical Controls - Mobile Touch Friendly */}
            <div className="grid grid-cols-4 gap-1.5 sm:gap-2 pt-1">
              <button
                onClick={handlePrev}
                disabled={filteredIndex === 0}
                className="bg-[#24221d] hover:bg-[#2e2b25] disabled:opacity-30 disabled:cursor-not-allowed text-white text-[11px] sm:text-xs font-semibold py-2.5 sm:py-3 rounded-xl border border-[#38352e] transition active:scale-95 flex items-center justify-center gap-1 min-h-[42px]"
                title="Previous Puzzle"
              >
                ◀ Prev
              </button>

              <button
                onClick={handleHint}
                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] sm:text-xs font-semibold py-2.5 sm:py-3 rounded-xl border border-amber-500/30 transition active:scale-95 flex items-center justify-center gap-1 min-h-[42px]"
                title="Tactical Hint (H)"
              >
                💡 Hint
              </button>

              <button
                onClick={handleShowGameBlunder}
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[11px] sm:text-xs font-semibold py-2.5 sm:py-3 rounded-xl border border-rose-500/30 transition active:scale-95 flex items-center justify-center gap-1 min-h-[42px]"
                title="Show What Was Played in Game (B)"
              >
                ⏪ Game
              </button>

              <button
                onClick={handleNext}
                disabled={filteredIndex >= filteredPuzzles.length - 1}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[11px] sm:text-xs font-bold py-2.5 sm:py-3 rounded-xl shadow-lg shadow-emerald-700/20 transition active:scale-95 flex items-center justify-center gap-1 min-h-[42px]"
                title="Next Puzzle"
              >
                Next ▶
              </button>
            </div>

            {/* Secondary actions */}
            <div className="flex items-center justify-between text-[11px] sm:text-xs px-1 text-[#7e7b73]">
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
                🔄 Flip
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Authentic Lichess Status & Notation */}
        <div className="lg:col-span-5 space-y-3 sm:space-y-4 w-full">
          <div className="bg-[#1e1c18] border border-[#2d2b25] rounded-2xl p-3.5 sm:p-5 shadow-xl space-y-3 sm:space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-2.5">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  Puzzle #{filteredIndex + 1}
                </h2>
                <p className="text-[11px] text-[#888] truncate max-w-[200px] sm:max-w-none">
                  {currentPuzzle.opening_name} ({currentPuzzle.opening_eco})
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {isCurrentSolved && (
                  <span className="text-[10px] sm:text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                    ✓ Solved
                  </span>
                )}
                <span className="text-[10px] sm:text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded font-mono border border-amber-500/20">
                  {currentPuzzle.primary_theme}
                </span>
              </div>
            </div>

            {/* Big Status Banner */}
            <div
              className={`p-3 sm:p-4 rounded-xl border text-center space-y-1 transition-all ${
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
              <div className="text-sm sm:text-base font-bold tracking-wide">{statusText.title}</div>
              {statusText.subtitle && (
                <div className="text-[11px] sm:text-xs text-[#999] leading-snug">{statusText.subtitle}</div>
              )}
            </div>

            {/* Lichess Move History Notation */}
            <div className="bg-[#141310] border border-[#2d2b25] rounded-xl p-3 min-h-[110px] flex flex-col justify-between">
              <div className="text-[10px] sm:text-[11px] text-[#7e7b73] uppercase font-semibold tracking-wider flex justify-between border-b border-[#2d2b25] pb-2 mb-2">
                <span>Played Line</span>
                <span className="font-mono text-emerald-400 text-[10px]">
                  {isCompleted ? 'Line Complete' : `${playedMoves.length} moves`}
                </span>
              </div>

              <div className="font-mono text-xs flex-1">
                {playedMoves.length === 0 ? (
                  <div className="text-[#555] italic text-center py-4 text-xs">
                    Play the winning move on the board...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
                    {playedMoves.map((m, idx) => {
                      const isUser = idx % 2 === 0;
                      return (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 sm:py-1 rounded ${
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

            {/* Post-Puzzle Analysis */}
            {isCompleted && (
              <div className="bg-[#141310] border border-emerald-500/30 rounded-xl p-3 sm:p-3.5 space-y-2 text-xs animate-fadeIn">
                <div className="font-semibold text-emerald-400 flex items-center justify-between">
                  <span>🧠 Post-Game Analysis</span>
                  <span className="font-mono text-[10px] text-[#888]">
                    In game: {currentPuzzle.played_move_san} (-{(currentPuzzle.eval_drop_cp / 100).toFixed(1)})
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px] sm:text-xs">{currentPuzzle.explanation}</p>
                <div className="pt-2 border-t border-[#2d2b25] font-mono text-[11px] text-emerald-300">
                  <span className="text-[#666] block font-sans text-[10px]">Full Winning Sequence:</span>
                  {currentPuzzle.continuation_str}
                </div>
              </div>
            )}

            {/* Big Next Button When Solved */}
            {isCompleted && (
              <button
                onClick={handleNext}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg transition active:scale-95 text-xs sm:text-sm flex items-center justify-center gap-1.5"
              >
                <span>Next Puzzle</span>
                <span>▶</span>
              </button>
            )}

            {/* Keyboard Shortcuts */}
            <div className="hidden sm:flex pt-1 items-center justify-between text-[11px] text-[#6b675e] border-t border-[#2d2b25]">
              <span>Shortcuts:</span>
              <div className="flex gap-2 font-mono">
                <span>[Space] Next</span>
                <span>[H] Hint</span>
                <span>[S] Auto-Play</span>
                <span>[F] Flip</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* DATABASE & PLAYER SELECTOR MODAL (User Onboarding & Switcher) */}
      {isDbModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
          <div className="bg-[#1e1c18] border border-[#3d3a33] w-full max-w-xl rounded-2xl shadow-2xl p-4 sm:p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                  <span>♟️</span> Select Training Database
                </h2>
                <p className="text-xs text-[#888]">
                  Choose whose games and which tactical set to train on:
                </p>
              </div>
              {localStorage.getItem('thetrainer_onboarded') && (
                <button
                  onClick={() => setIsDbModalOpen(false)}
                  className="w-8 h-8 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white flex items-center justify-center border border-[#38352e]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Step 1: Select Player / Database */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#aaa] uppercase tracking-wider block">
                1. Select Player Database
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {databases.map((dbItem) => {
                  const isSelected = selectedPlayerForSubmenu === dbItem.id;
                  return (
                    <div
                      key={dbItem.id}
                      onClick={() => {
                        if (dbItem.available) {
                          setSelectedPlayerForSubmenu(dbItem.id);
                          if (dbItem.id === 'grandmasters') {
                            handleSelectSet('world-champions');
                          }
                        }
                      }}
                      className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                        !dbItem.available
                          ? 'opacity-40 bg-[#161512] border-[#2d2b25] cursor-not-allowed'
                          : isSelected
                          ? 'bg-[#2b2720] border-amber-500 shadow-md ring-1 ring-amber-500'
                          : 'bg-[#181613] border-[#2d2b25] hover:border-[#444] hover:bg-[#201e19]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{dbItem.icon}</span>
                          <div>
                            <div className="font-bold text-sm text-white">{dbItem.name}</div>
                            <div className="text-[10px] text-amber-400 font-mono">{dbItem.rating}</div>
                          </div>
                        </div>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                            dbItem.available
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          }`}
                        >
                          {dbItem.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#888] leading-snug">{dbItem.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: If Shohan selected, choose Collection */}
            {selectedPlayerForSubmenu === 'shohan' && (
              <div className="space-y-2 pt-2 border-t border-[#2d2b25] animate-fadeIn">
                <label className="text-xs font-bold text-[#aaa] uppercase tracking-wider block">
                  2. Choose Training Collection
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allSets
                    .filter((s) => s.id !== 'world-champions')
                    .map((s) => {
                      const isSelected = s.id === currentSetId;
                      return (
                        <button
                          key={s.id}
                          onClick={() => handleSelectSet(s.id)}
                          className={`p-3 rounded-xl text-left border transition flex items-center justify-between ${
                            isSelected
                              ? 'bg-amber-500/20 border-amber-500 text-white shadow-sm'
                              : 'bg-[#181613] border-[#2d2b25] hover:bg-[#262420] text-[#ccc]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <span className="text-xl shrink-0">{s.icon}</span>
                            <div className="truncate">
                              <div className="font-bold text-xs text-white truncate">{s.title}</div>
                              <div className="text-[10px] text-[#888] truncate">{s.subtitle}</div>
                            </div>
                          </div>
                          <span className="font-mono text-xs font-bold text-amber-400 ml-2 shrink-0">
                            {s.puzzles.length}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drawer: Browse All Puzzles in Current Set */}
      {isDrawerOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-sm sm:max-w-md bg-[#1e1c18] border-l border-[#2d2b25] h-full flex flex-col shadow-2xl p-4 sm:p-5 space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between border-b border-[#2d2b25] pb-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <span>{currentSet.icon}</span> {currentSet.title}
                </h2>
                <span className="text-[10px] sm:text-[11px] text-[#888]">
                  {filteredPuzzles.length} available in set
                </span>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-8 h-8 rounded-lg bg-[#262420] hover:bg-[#322f2a] text-white flex items-center justify-center border border-[#38352e]"
              >
                ✕
              </button>
            </div>

            {/* Quick Set Switcher Tabs inside Drawer */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
              {allSets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelectSet(s.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold shrink-0 transition flex items-center gap-1 ${
                    s.id === currentSetId
                      ? 'bg-amber-500 text-black font-bold'
                      : 'bg-[#161512] text-[#888] hover:text-white border border-[#2d2b25]'
                  }`}
                >
                  <span>{s.icon}</span>
                  <span>{s.title}</span>
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
                  className="bg-[#161512] border border-[#2d2b25] rounded-xl px-2.5 py-1.5 text-white focus:outline-none text-xs"
                >
                  <option value="all">Both Colors</option>
                  <option value="white">As White</option>
                  <option value="black">As Black</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'unsolved' | 'solved')}
                  className="bg-[#161512] border border-[#2d2b25] rounded-xl px-2.5 py-1.5 text-white focus:outline-none text-xs"
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
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingApp;
