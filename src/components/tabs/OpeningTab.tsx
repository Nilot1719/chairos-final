import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  GripVertical,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import type { AttendanceStatus, CaucusState, Delegate } from '../../types/mun';
import {
  BLUEPRINT_BOUNDS,
  dedupeSpeakerQueue,
  formatClock,
  isCountryInSpeakerList,
} from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';
import { EditableTimer } from '../EditableTimer';

interface OpeningTabProps {
  caucus: CaucusState | undefined;
  liveSpeakerSeconds: number;
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  onUpdateCaucus: (
    patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>
  ) => Promise<void>;
  onCompleteSpeaker: (params: {
    speakerId: string;
    speakerName: string;
    durationSeconds: number;
    note: string;
    nextSpeakerId: string;
    nextQueue: string[];
    nextSlotsUsed: number;
  }) => Promise<void>;
}

export function OpeningTab({
  caucus,
  liveSpeakerSeconds,
  delegates,
  attendance,
  onUpdateCaucus,
  onCompleteSpeaker,
}: OpeningTabProps) {
  const [searchAdd, setSearchAdd] = useState('');
  const [speechNote, setSpeechNote] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const autoSeededRef = useRef(false);

  const delegateMap = useMemo(() => new Map(delegates.map((d) => [d.id, d])), [delegates]);

  const activeDelegatesAZ = useMemo(() => {
    const present = delegates.filter((d) => {
      const st = attendance[d.id];
      return st === 'present' || st === 'pv';
    });
    return (present.length > 0 ? present : [...delegates]).sort((a, b) =>
      a.countryName.localeCompare(b.countryName)
    );
  }, [delegates, attendance]);

  const allDelegatesAZ = useMemo(
    () => [...delegates].sort((a, b) => a.countryName.localeCompare(b.countryName)),
    [delegates]
  );

  const filteredAddList = useMemo(() => {
    const q = searchAdd.trim().toLowerCase();
    return allDelegatesAZ.filter((d) => q === '' || d.countryName.toLowerCase().includes(q));
  }, [allDelegatesAZ, searchAdd]);

  const currentSpeaker = caucus?.currentSpeakerId
    ? delegateMap.get(caucus.currentSpeakerId)
    : undefined;
  const queue = useMemo(
    () => dedupeSpeakerQueue(caucus?.queue || [], caucus?.currentSpeakerId),
    [caucus?.queue, caucus?.currentSpeakerId]
  );
  const defaultSpeakerSecs = caucus?.speakerSeconds || 60;
  const slotsUsed = caucus?.slotsUsed || 0;

  // Automatically populate delegations alphabetically on first empty opening state
  useEffect(() => {
    const isUntouchedEmpty =
      (!caucus || (!caucus.currentSpeakerId && caucus.queue.length === 0 && (caucus.slotsUsed || 0) === 0)) &&
      activeDelegatesAZ.length > 0;

    if (!isUntouchedEmpty || autoSeededRef.current) return;
    autoSeededRef.current = true;

    const [first, ...rest] = activeDelegatesAZ;
    onUpdateCaucus({
      topic: caucus?.topic || 'Opening Speeches',
      speakerSeconds: caucus?.speakerSeconds || 60,
      speakerRemainingSeconds: caucus?.speakerSeconds || 60,
      currentSpeakerId: first.id,
      queue: rest.map((d) => d.id),
      slotsUsed: 0,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    }).catch(() => {
      autoSeededRef.current = false;
    });
  }, [caucus, activeDelegatesAZ, onUpdateCaucus]);

  const handleResetAlphabetical = async () => {
    if (activeDelegatesAZ.length === 0) return;
    const [first, ...rest] = activeDelegatesAZ;
    await onUpdateCaucus({
      topic: caucus?.topic || 'Opening Speeches',
      currentSpeakerId: first.id,
      queue: rest.map((d) => d.id),
      slotsUsed: 0,
      speakerRemainingSeconds: defaultSpeakerSecs,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleSortQueueAlphabetical = async () => {
    const sortedQueue = [...queue].sort((aId, bId) => {
      const aName = delegateMap.get(aId)?.countryName || '';
      const bName = delegateMap.get(bId)?.countryName || '';
      return aName.localeCompare(bName);
    });
    await onUpdateCaucus({ queue: sortedQueue });
  };

  const handleToggleTimer = async () => {
    const currentRem = caucus ? liveSpeakerSeconds : defaultSpeakerSecs;
    if (caucus?.timerRunning) {
      await onUpdateCaucus({
        timerRunning: false,
        speakerRemainingSeconds: currentRem,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        timerRunning: true,
        speakerRemainingSeconds: currentRem > 0 ? currentRem : defaultSpeakerSecs,
        timerUpdatedAtMs: Date.now(),
      });
    }
  };

  const handleResetTimer = async () => {
    await onUpdateCaucus({
      timerRunning: false,
      speakerRemainingSeconds: defaultSpeakerSecs,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleChangeDefaultTime = async (secs: number) => {
    await onUpdateCaucus({
      speakerSeconds: secs,
      speakerRemainingSeconds: secs,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleCommitCustomTime = async (nextSeconds: number) => {
    await onUpdateCaucus({
      speakerSeconds: nextSeconds > 0 ? nextSeconds : defaultSpeakerSecs,
      speakerRemainingSeconds: nextSeconds,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleMoveQueue = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= queue.length) return;
    const copy = [...queue];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    await onUpdateCaucus({ queue: copy });
  };

  const handleReorderDrop = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= queue.length || toIdx >= queue.length) {
      return;
    }
    const copy = [...queue];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    await onUpdateCaucus({ queue: copy });
  };

  const handleSwapToCurrent = async (queueIndex: number) => {
    const pickedId = queue[queueIndex];
    if (!pickedId) return;
    const nextQueue = [...queue];
    nextQueue.splice(queueIndex, 1);
    if (caucus?.currentSpeakerId) {
      nextQueue.unshift(caucus.currentSpeakerId);
    }
    await onUpdateCaucus({
      currentSpeakerId: pickedId,
      queue: nextQueue,
      speakerRemainingSeconds: defaultSpeakerSecs,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleRemoveFromQueue = async (index: number) => {
    const copy = [...queue];
    copy.splice(index, 1);
    await onUpdateCaucus({ queue: copy });
  };

  const handleAddToQueue = async (delegateId: string) => {
    if (isCountryInSpeakerList(delegateId, caucus?.currentSpeakerId, queue, delegateMap)) {
      return;
    }
    if (!caucus?.currentSpeakerId) {
      await onUpdateCaucus({
        currentSpeakerId: delegateId,
        speakerRemainingSeconds: defaultSpeakerSecs,
        timerRunning: false,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        queue: dedupeSpeakerQueue([...queue, delegateId], caucus.currentSpeakerId),
      });
    }
  };

  const handleCompleteAndNext = async () => {
    const [nextId = '', ...restQueue] = queue;
    if (!currentSpeaker) {
      if (nextId) {
        await onUpdateCaucus({
          currentSpeakerId: nextId,
          queue: restQueue,
          speakerRemainingSeconds: defaultSpeakerSecs,
          timerRunning: false,
          timerUpdatedAtMs: Date.now(),
        });
      }
      return;
    }

    const elapsed = Math.max(1, defaultSpeakerSecs - liveSpeakerSeconds);
    await onCompleteSpeaker({
      speakerId: currentSpeaker.id,
      speakerName: currentSpeaker.countryName,
      durationSeconds: elapsed,
      note: speechNote.trim(),
      nextSpeakerId: nextId,
      nextQueue: restQueue,
      nextSlotsUsed: slotsUsed + 1,
    });
    setSpeechNote('');
  };

  const handleSkipAndNext = async () => {
    const [nextId = '', ...restQueue] = queue;
    await onUpdateCaucus({
      currentSpeakerId: nextId,
      queue: restQueue,
      slotsUsed: slotsUsed + (currentSpeaker ? 1 : 0),
      speakerRemainingSeconds: defaultSpeakerSecs,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
    setSpeechNote('');
  };

  return (
    <div className="h-full min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
      {/* Left Column: Opening Speech Stage (No POIs) */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col gap-5 xl:h-full min-h-0 xl:overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 shrink-0">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Opening Speeches (Alphabetical · No POIs)
            </h3>
            <p className="text-xs text-slate-500">
              Auto-populates A–Z by delegation; drag or reorder the queue manually whenever needed
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">Presets:</span>
            {[30, 45, 60, 90, 120].map((secs) => (
              <button
                key={secs}
                type="button"
                onClick={() => handleChangeDefaultTime(secs)}
                className={`px-2 py-1 font-mono-tabular font-semibold rounded-md transition-colors cursor-pointer ${
                  defaultSpeakerSecs === secs
                    ? 'bg-[#0047AB] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {secs}s
              </button>
            ))}
          </div>
        </div>

        {/* Active Opening Speaker & Editable Countdown */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 bg-slate-50 border border-slate-200 rounded-xl shrink-0">
          <div className="space-y-1.5 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Current Opening Speaker
            </span>
            {currentSpeaker ? (
              <div className="flex items-center gap-3">
                <CountryFlag
                  code={currentSpeaker.countryCode}
                  name={currentSpeaker.countryName}
                  size="lg"
                />
                <div className="min-w-0">
                  <div className="font-display text-xl font-bold text-slate-900 truncate">
                    {currentSpeaker.countryName}
                  </div>
                  <div className="text-xs text-slate-500 font-mono-tabular">
                    Completed: {slotsUsed} · Total Speeches: {currentSpeaker.speechesCount}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Opening speech order complete. Use &quot;Reset A–Z&quot; or tap a delegation to add.
              </div>
            )}
          </div>

          <div className="text-left sm:text-right shrink-0">
            <EditableTimer
              seconds={caucus ? liveSpeakerSeconds : defaultSpeakerSecs}
              maxSeconds={600}
              size="lg"
              warningThreshold={10}
              onCommitSeconds={handleCommitCustomTime}
            />
            <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
              limit {formatClock(defaultSpeakerSecs)}
            </div>
          </div>
        </div>

        {/* Live Note for Opening Speech */}
        <div className="space-y-1.5 shrink-0">
          <label
            htmlFor="opening-speech-note"
            className="block text-xs font-semibold text-slate-700"
          >
            Opening Statement Note (saved separately with this speech)
          </label>
          <textarea
            id="opening-speech-note"
            rows={3}
            maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
            disabled={!currentSpeaker}
            value={speechNote}
            onChange={(e) => setSpeechNote(e.target.value)}
            placeholder={
              currentSpeaker
                ? `Notes for ${currentSpeaker.countryName}'s opening statement...`
                : 'Select or load a speaker to record opening speech notes...'
            }
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
          />
        </div>

        {/* Timer & Progression Controls */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!currentSpeaker}
            onClick={handleToggleTimer}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            {caucus?.timerRunning ? (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Speech
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!currentSpeaker}
            onClick={handleResetTimer}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Timer
          </button>

          <button
            type="button"
            disabled={!currentSpeaker && queue.length === 0}
            onClick={handleSkipAndNext}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors ml-auto cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
            Skip Without Logging
          </button>

          <button
            type="button"
            disabled={!currentSpeaker && queue.length === 0}
            onClick={handleCompleteAndNext}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
            Log Speech &amp; Next
          </button>
        </div>

        <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Points of Information (POIs) are disabled during Opening Speeches.</span>
          <span className="font-mono-tabular">
            Remaining in queue: <strong className="text-slate-800">{queue.length}</strong>
          </span>
        </div>
      </div>

      {/* Right Column: Alphabetical & Manually Reorderable Speaking Order */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 xl:h-full min-h-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Speaking Order ({queue.length})
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleResetAlphabetical}
              title="Populate all active delegations alphabetically A–Z"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              Reset A–Z
            </button>
            {queue.length > 1 && (
              <button
                type="button"
                onClick={handleSortQueueAlphabetical}
                title="Sort remaining queue alphabetically without changing current speaker"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              >
                <ArrowDownAZ className="w-3.5 h-3.5" />
                Sort Queue
              </button>
            )}
            {queue.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdateCaucus({ queue: [] })}
                className="px-2 py-1 text-[11px] text-slate-500 hover:text-red-600 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Reorderable Queue */}
        <div className="flex-1 min-h-[180px] flex flex-col overflow-hidden">
          {queue.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center text-xs text-slate-500">
              No delegations queued. Click <strong>Reset A–Z</strong> or add delegations below.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {queue.map((delId, idx) => {
                const del = delegateMap.get(delId);
                if (!del) return null;
                const isDragging = dragIndex === idx;
                const isDropTarget = dropTargetIndex === idx && dragIndex !== idx;

                return (
                  <div
                    key={`${delId}_${idx}`}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dropTargetIndex !== idx) setDropTargetIndex(idx);
                    }}
                    onDragLeave={() => {
                      if (dropTargetIndex === idx) setDropTargetIndex(null);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const from = dragIndex;
                      setDragIndex(null);
                      setDropTargetIndex(null);
                      if (from !== null) {
                        await handleReorderDrop(from, idx);
                      }
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropTargetIndex(null);
                    }}
                    className={`px-2.5 py-2 flex items-center justify-between gap-2 transition-colors ${
                      isDragging
                        ? 'opacity-50 bg-blue-50'
                        : isDropTarget
                          ? 'bg-blue-50/70 border-t-2 border-t-[#0047AB]'
                          : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        title="Drag to reorder"
                        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-mono-tabular text-xs text-slate-400 w-5 shrink-0">
                        {idx + 1}.
                      </span>
                      <CountryFlag code={del.countryCode} name={del.countryName} size="sm" />
                      <span className="text-xs font-semibold text-slate-800 truncate">
                        {del.countryName}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSwapToCurrent(idx)}
                        title="Move to current floor speaker"
                        className="px-2 py-0.5 text-[10px] font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded transition-colors cursor-pointer"
                      >
                        Speak
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveQueue(idx, -1)}
                        aria-label="Move up"
                        className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === queue.length - 1}
                        onClick={() => handleMoveQueue(idx, 1)}
                        aria-label="Move down"
                        className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromQueue(idx)}
                        aria-label="Remove from queue"
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Delegation Section */}
        <div className="pt-3 border-t border-slate-100 flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Add Delegation to Order
            </span>
            <input
              type="text"
              value={searchAdd}
              onChange={(e) => setSearchAdd(e.target.value)}
              placeholder="Filter..."
              className="w-36 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-[#0047AB]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
            {filteredAddList.map((d) => {
              const inCurrent = currentSpeaker?.id === d.id;
              const qPos = queue.indexOf(d.id);
              const alreadyListed = isCountryInSpeakerList(
                d.id,
                currentSpeaker?.id,
                queue,
                delegateMap
              );
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={alreadyListed}
                  onClick={() => handleAddToQueue(d.id)}
                  title={
                    alreadyListed
                      ? `${d.countryName} is already in the speakers list`
                      : `Add ${d.countryName} to speaking order`
                  }
                  className={`px-2.5 py-1.5 border rounded-lg flex items-center justify-between gap-1.5 text-left transition-colors ${
                    alreadyListed
                      ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                      : 'bg-slate-50 hover:bg-blue-50 border-slate-200 hover:border-blue-300 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <CountryFlag code={d.countryCode} name={d.countryName} size="sm" />
                    <span className="text-xs font-medium text-slate-800 truncate">
                      {d.countryName}
                    </span>
                  </span>
                  {inCurrent ? (
                    <span className="text-[10px] font-semibold text-[#0047AB] shrink-0">Now</span>
                  ) : qPos !== -1 ? (
                    <span className="text-[10px] font-mono-tabular text-slate-500 shrink-0">
                      #{qPos + 1}
                    </span>
                  ) : alreadyListed ? (
                    <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                      Added
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
