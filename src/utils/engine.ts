// Browser-based Stockfish 10 Engine using WebAssembly / Web Worker

export interface EngineEvaluation {
  score: string; // e.g. "+3.85", "-1.20", "+M2"
  scoreCp: number; // in centipawns or mate equivalent
  bestMove: string; // UCI format e.g. "e4d5"
  depth: number;
  pv: string[];
}

export class BrowserEngine {
  private worker: Worker | null = null;
  public isReady: boolean = false;
  private onEval: ((evalData: EngineEvaluation) => void) | null = null;
  private currentFen: string = '';

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === 'undefined') return;
    try {
      // Determine worker URL based on location
      const workerUrl = new URL('./stockfish.js', window.location.href).href;
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e: MessageEvent) => {
        this.handleMessage(e.data);
      };

      this.worker.onerror = (err) => {
        console.warn('Stockfish worker error:', err);
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('setoption name Threads value 2');
      this.worker.postMessage('setoption name Hash value 32');
      this.worker.postMessage('isready');
    } catch (err) {
      console.warn('Could not initialize Stockfish in browser:', err);
    }
  }

  private handleMessage(data: unknown) {
    if (typeof data !== 'string') return;
    const line = data.trim();

    if (line === 'readyok') {
      this.isReady = true;
    }

    if (line.startsWith('info') && line.includes('score')) {
      let scoreStr = '+0.00';
      let scoreCp = 0;

      if (line.includes('score mate')) {
        const m = line.match(/score mate (-?\d+)/);
        if (m) {
          const mateVal = parseInt(m[1], 10);
          scoreStr = mateVal > 0 ? `+M${mateVal}` : `-M${Math.abs(mateVal)}`;
          scoreCp = mateVal > 0 ? 10000 - mateVal : -10000 - mateVal;
        }
      } else if (line.includes('score cp')) {
        const m = line.match(/score cp (-?\d+)/);
        if (m) {
          const cp = parseInt(m[1], 10);
          scoreCp = cp;
          scoreStr = `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
        }
      }

      const depthMatch = line.match(/depth (\d+)/);
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;

      const pvMatch = line.match(/pv (.+)/);
      const pvTokens = pvMatch ? pvMatch[1].split(' ') : [];
      const bestMove = pvTokens[0] || '';

      if (this.onEval) {
        this.onEval({
          score: scoreStr,
          scoreCp,
          bestMove,
          depth,
          pv: pvTokens.slice(0, 5),
        });
      }
    }
  }

  public evaluate(
    fen: string,
    depth: number = 14,
    callback?: (evalData: EngineEvaluation) => void
  ) {
    if (!this.worker) return;
    this.currentFen = fen;
    if (callback) this.onEval = callback;

    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  }

  public stop() {
    if (this.worker) {
      this.worker.postMessage('stop');
    }
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Global browser engine singleton
export const browserEngine = new BrowserEngine();
