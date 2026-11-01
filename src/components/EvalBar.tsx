import React from 'react';

interface EvalBarProps {
  scoreText: string;
  orientation: 'white' | 'black';
  className?: string;
}

export const EvalBar: React.FC<EvalBarProps> = ({ scoreText, orientation, className = '' }) => {
  let whitePercent = 50;

  if (scoreText.startsWith('+M') || scoreText.startsWith('M+')) {
    whitePercent = 100;
  } else if (scoreText.startsWith('-M') || scoreText.startsWith('M-')) {
    whitePercent = 0;
  } else {
    const val = parseFloat(scoreText.replace('+', ''));
    if (!isNaN(val)) {
      const clamped = Math.max(-10, Math.min(10, val));
      whitePercent = 50 + (clamped / 10) * 45;
    }
  }

  const fillHeight = orientation === 'white' ? whitePercent : 100 - whitePercent;

  return (
    <div
      className={`relative w-3.5 sm:w-5 shrink-0 bg-[#202020] rounded-lg overflow-hidden border border-[#383838] flex flex-col justify-end select-none shadow-md ${className}`}
      title={`Evaluation: ${scoreText}`}
    >
      <div
        className="w-full bg-[#f1f1f1] transition-all duration-500 ease-out"
        style={{ height: `${fillHeight}%` }}
      />
      <div className="absolute inset-x-0 bottom-1 flex justify-center pointer-events-none">
        <span
          className={`text-[8px] sm:text-[9px] font-mono font-bold px-0.5 rounded leading-none ${
            fillHeight > 50 ? 'text-black' : 'text-white'
          }`}
        >
          {scoreText}
        </span>
      </div>
    </div>
  );
};
