import React, { useState } from 'react';
import { Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { CaucusState, UnmodBloc } from '../../types/mun';
import { BLUEPRINT_BOUNDS, formatClock } from '../../lib/munRules';
import { EditableTimer } from '../EditableTimer';

interface UnmodTabProps {
  caucus: CaucusState | undefined;
  liveTotalSeconds: number;
  blocs: UnmodBloc[];
  onUpdateCaucus: (patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>) => Promise<void>;
  onCreateBloc: (fields: { title: string; sponsors: string; notes: string }) => Promise<void>;
  onDeleteBloc: (blocId: string) => Promise<void>;
}

export function UnmodTab({
  caucus,
  liveTotalSeconds,
  blocs,
  onUpdateCaucus,
  onCreateBloc,
  onDeleteBloc,
}: UnmodTabProps) {
  const [topicDraft, setTopicDraft] = useState(caucus?.topic || '');
  const [blocTitle, setBlocTitle] = useState('');
  const [blocSponsors, setBlocSponsors] = useState('');
  const [blocNotes, setBlocNotes] = useState('');
  const [savingBloc, setSavingBloc] = useState(false);

  const totalSecs = caucus?.totalSeconds || 600;

  const handleSetDuration = async (minutes: number) => {
    const secs = minutes * 60;
    await onUpdateCaucus({
      totalSeconds: secs,
      totalRemainingSeconds: secs,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleExtend = async (addSecs: number) => {
    await onUpdateCaucus({
      totalSeconds: Math.min(7200, totalSecs + addSecs),
      totalRemainingSeconds: Math.min(7200, liveTotalSeconds + addSecs),
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleToggle = async () => {
    if (!caucus) return;
    if (caucus.timerRunning) {
      await onUpdateCaucus({
        timerRunning: false,
        totalRemainingSeconds: liveTotalSeconds,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        timerRunning: true,
        totalRemainingSeconds: liveTotalSeconds > 0 ? liveTotalSeconds : totalSecs,
        timerUpdatedAtMs: Date.now(),
      });
    }
  };

  const handleAddBloc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blocTitle.trim()) return;
    setSavingBloc(true);
    try {
      await onCreateBloc({
        title: blocTitle.trim(),
        sponsors: blocSponsors.trim(),
        notes: blocNotes.trim(),
      });
      setBlocTitle('');
      setBlocSponsors('');
      setBlocNotes('');
    } finally {
      setSavingBloc(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
      {/* Left: Focused Unmod Countdown Stage */}
      <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-6 xl:h-full min-h-0 xl:overflow-y-auto">
        <div className="space-y-2">
          <label
            htmlFor="unmod-topic"
            className="block text-xs font-semibold text-slate-700"
          >
            Unmoderated Caucus Purpose (shown on Projector)
          </label>
          <div className="flex gap-2">
            <input
              id="unmod-topic"
              type="text"
              maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              placeholder="e.g., Bloc formation & working paper drafting"
              className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
            <button
              type="button"
              onClick={() => onUpdateCaucus({ topic: topicDraft.trim() })}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer"
            >
              Update
            </button>
          </div>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 mr-1">Presets:</span>
            {[5, 10, 15, 20].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleSetDuration(m)}
                className={`px-2.5 py-1 text-xs font-mono-tabular font-semibold rounded-md transition-colors cursor-pointer ${
                  totalSecs === m * 60
                    ? 'bg-[#0047AB] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleExtend(60)}
              className="px-2.5 py-1 text-xs font-mono-tabular font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
            >
              +1m
            </button>
            <button
              type="button"
              onClick={() => handleExtend(120)}
              className="px-2.5 py-1 text-xs font-mono-tabular font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
            >
              +2m
            </button>
          </div>
        </div>

        {/* Large Editable Timer */}
        <div className="py-8 px-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center text-center space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Unmoderated Caucus Remaining
          </div>
          <EditableTimer
            seconds={liveTotalSeconds}
            maxSeconds={7200}
            size="xl"
            warningThreshold={30}
            onCommitSeconds={async (secs) => {
              await onUpdateCaucus({
                totalSeconds: secs > 0 ? secs : totalSecs,
                totalRemainingSeconds: secs,
                timerRunning: false,
                timerUpdatedAtMs: Date.now(),
              });
            }}
          />
          <div className="text-xs text-slate-500 font-mono-tabular">
            of {formatClock(totalSecs)}
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleToggle}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors cursor-pointer"
          >
            {caucus?.timerRunning ? (
              <>
                <Pause className="w-4 h-4" />
                Pause Caucus
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Caucus
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateCaucus({
                timerRunning: false,
                totalRemainingSeconds: totalSecs,
                timerUpdatedAtMs: Date.now(),
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Right: Chair Observations & Bloc / Working Paper Tracker */}
      <div className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4 xl:h-full min-h-0 xl:overflow-hidden">
        <div className="shrink-0">
          <h3 className="font-display text-base font-bold text-slate-900">
            Bloc &amp; Working Paper Observations
          </h3>
          <p className="text-xs text-slate-500">
            Track emerging lobbying groups, sponsors, and draft clauses (included in PDF export)
          </p>
        </div>

        <form onSubmit={handleAddBloc} className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.BLOC_TITLE_MAX}
              value={blocTitle}
              onChange={(e) => setBlocTitle(e.target.value)}
              placeholder="Bloc / Working Paper title..."
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
            />
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.BLOC_SPONSORS_MAX}
              value={blocSponsors}
              onChange={(e) => setBlocSponsors(e.target.value)}
              placeholder="Sponsors (e.g., Germany, Thailand, France)"
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
            />
          </div>
          <textarea
            rows={2}
            maxLength={BLUEPRINT_BOUNDS.BLOC_NOTES_MAX}
            value={blocNotes}
            onChange={(e) => setBlocNotes(e.target.value)}
            placeholder="Observed chair notes on leadership, key clauses, or merges..."
            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingBloc || !blocTitle.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {savingBloc ? 'Adding...' : 'Add Bloc Note'}
            </button>
          </div>
        </form>

        <div className="flex-1 min-h-[160px] overflow-y-auto space-y-2.5 pr-0.5">
          {blocs.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center text-xs text-slate-500">
              No bloc observations logged yet.
            </div>
          ) : (
            blocs.map((b) => (
              <div
                key={b.id}
                className="p-3.5 border border-slate-200 rounded-lg flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-slate-900">{b.title}</div>
                  {b.sponsors && (
                    <div className="text-xs text-[#0047AB] font-medium">
                      Sponsors: {b.sponsors}
                    </div>
                  )}
                  {b.notes && <p className="text-xs text-slate-600">{b.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteBloc(b.id)}
                  aria-label="Delete bloc note"
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
