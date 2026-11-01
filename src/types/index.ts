export interface ChessPuzzle {
  id: string;
  game_id: string;
  game_url: string;
  date: string;
  player_color: 'white' | 'black';
  player_rating: number;
  opponent: string;
  opponent_rating: number;
  opening_name: string;
  opening_eco: string;
  move_number: number;
  fen: string;
  played_move_san: string;
  played_move_uci: string;
  best_move_san: string;
  best_move_uci: string;
  continuation_san: string[];
  continuation_str: string;
  eval_before: string;
  eval_after_played: string;
  eval_drop_cp: number;
  category: string;
  primary_theme: string;
  all_themes: string[];
  explanation: string;
  turn: 'White' | 'Black';
}

export interface PuzzleSet {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  badge: string;
  puzzles: ChessPuzzle[];
}
