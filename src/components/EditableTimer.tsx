import React, { useEffect, useState } from 'react';
import { formatClock } from '../lib/munRules';

interface EditableTimerProps {
  seconds: number;
  maxSeconds?: number;
  size?: 'md' | 'lg' | 'xl';
  warningThreshold?: number;
  label?: string;
  onCommitSeconds: (nextSeconds: number) => void;
}

export function EditableTimer({
  seconds,
  maxSeconds = 7200,
  size = 'lg',
  warningThreshold = 15,
  label,
  onCommitSeconds,
}: EditableTimerProps) {
  const [editing, setEditing] = useState(false);
  const [minInput, setMinInput] = useState('0');
  const [secInput, setSecInput] = useState('00');

  useEffect(() => {
    if (!editing) {
      const m = Math.floor(Math.max(0, seconds) / 60);
      const s = Math.max(0, seconds) % 60;
      setMinInput(String(m));
      setSecInput(String(s).padStart(2, '0'));
    }
  }, [seconds, editing]);

  const handleOpenEdit = () => {
    const m = Math.floor(Math.max(0, seconds) / 60);
    const s = Math.max(0, seconds) % 60;
    setMinInput(String(m));
    setSecInput(String(s).padStart(2, '0'));
    setEditing(true);
  };

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const mins = Math.max(0, parseInt(minInput || '0', 10) || 0);
    const secs = Math.max(0, parseInt(secInput || '0', 10) || 0);
    const total = Math.max(0, Math.min(maxSeconds, mins * 60 + secs));
    onCommitSeconds(total);
    setEditing(false);
  };

  const sizeClasses =
    size === 'xl'
      ? 'text-6xl sm:text-7xl'
      : size === 'md'
        ? 'text-3xl sm:text-4xl'
        : 'text-5xl';

  const colorClass =
    seconds === 0
      ? 'text-red-600'
      : seconds <= warningThreshold
        ? 'text-amber-600'
        : 'text-[#0047AB]';

  if (editing) {
    return (
      <form onSubmit={handleApply} className="inline-flex flex-col items-start gap-1.5">
        {label && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={Math.floor(maxSeconds / 60)}
            aria-label="Minutes"
            autoFocus
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            className="w-16 px-2 py-1.5 text-lg font-mono-tabular font-bold text-center bg-white border border-[#0047AB] rounded-lg text-slate-900 focus:outline-none"
          />
          <span className="font-mono-tabular text-lg font-bold text-slate-500">:</span>
          <input
            type="number"
            min={0}
            max={59}
            aria-label="Seconds"
            value={secInput}
            onChange={(e) => setSecInput(e.target.value)}
            className="w-16 px-2 py-1.5 text-lg font-mono-tabular font-bold text-center bg-white border border-[#0047AB] rounded-lg text-slate-900 focus:outline-none"
          />
          <button
            type="submit"
            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer"
          >
            Set
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="inline-flex flex-col">
      {label && (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={handleOpenEdit}
        title="Click to type custom time (MM:SS)"
        className={`group text-left font-mono-tabular ${sizeClasses} font-bold tracking-tight ${colorClass} hover:opacity-80 transition-opacity cursor-pointer`}
      >
        {formatClock(seconds)}
        <span className="block text-[11px] font-sans font-medium text-slate-400 group-hover:text-[#0047AB] transition-colors mt-0.5">
          Click time to type MM:SS
        </span>
      </button>
    </div>
  );
}
