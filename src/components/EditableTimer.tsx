import React, { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
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
  const [inputError, setInputError] = useState('');

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
    setInputError('');
    setEditing(true);
  };

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const mins = Number(minInput || '0');
    const secs = Number(secInput || '0');
    if (
      !Number.isInteger(mins) ||
      mins < 0 ||
      mins > Math.floor(maxSeconds / 60) ||
      !Number.isInteger(secs) ||
      secs < 0 ||
      secs > 59
    ) {
      setInputError(`Enter minutes up to ${Math.floor(maxSeconds / 60)} and seconds from 0 to 59.`);
      return;
    }
    const total = Math.max(0, Math.min(maxSeconds, mins * 60 + secs));
    onCommitSeconds(total);
    setEditing(false);
    setInputError('');
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
      <form onSubmit={handleApply} className="inline-flex flex-col items-start gap-2">
        {label && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Minutes"
            autoFocus
            value={minInput}
            onChange={(e) => {
              setMinInput(e.target.value.replace(/\D/g, ''));
              setInputError('');
            }}
            className="w-16 px-2 py-1.5 text-lg font-mono-tabular font-bold text-center bg-white border border-[#0047AB] rounded-lg text-slate-900 focus:outline-none"
          />
          <span className="font-mono-tabular text-lg font-bold text-slate-500 px-0.5">:</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Seconds"
            value={secInput}
            onChange={(e) => {
              setSecInput(e.target.value.replace(/\D/g, '').slice(0, 2));
              setInputError('');
            }}
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
        {inputError && <span role="alert" className="text-xs text-red-600">{inputError}</span>}
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
        title="Edit time"
        aria-label={`Edit timer, ${formatClock(seconds)}`}
        className={`group inline-flex items-center gap-2 text-left font-mono-tabular ${sizeClasses} font-bold tracking-tight ${colorClass} hover:opacity-80 transition-opacity cursor-pointer`}
      >
        {formatClock(seconds)}
        <Pencil
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-[#0047AB]"
        />
      </button>
    </div>
  );
}
