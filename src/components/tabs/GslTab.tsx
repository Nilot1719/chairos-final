import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  MessageSquarePlus,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react';
import type { AttendanceStatus, CaucusState, Delegate, YieldType } from '../../types/mun';
import {
  BLUEPRINT_BOUNDS,
  dedupeSpeakerQueue,
  formatClock,
  isCountryInSpeakerList,
} from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';
import { EditableTimer } from '../EditableTimer';

interface GslTabProps {
  caucus: CaucusState | undefined;
  liveSpeakerSeconds: number;
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  onUpdateCaucus: (patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>) => Promise<void>;
  onCompleteSpeaker: (params: {
    speakerId: string;
    speakerName: string;
    durationSeconds: number;
    yieldType: YieldType;
    yieldTargetName: string;
    note: string;
    nextSpeakerId: string;
    nextQueue: string[];
  }) => Promise<void>;
  onLogPoi: (questioner: Delegate, targetName: string, note: string) => Promise<void>;
}

export function GslTab({
  caucus,
  liveSpeakerSeconds,
  delegates,
  attendance,
  onUpdateCaucus,
  onCompleteSpeaker,
  onLogPoi,
}: GslTabProps) {
  const [searchAdd, setSearchAdd] = useState('');
  const [speechNote, setSpeechNote] = useState('');
  const [poiQuestionerId, setPoiQuestionerId] = useState('');
  const [poiNote, setPoiNote] = useState('');
  const [poiFlash, setPoiFlash] = useState<string | null>(null);

  const delegateMap = useMemo(() => new Map(delegates.map((d) => [d.id, d])), [delegates]);

  const activeDelegates = useMemo(() => {
    const present = delegates.filter((d) => {
      const st = attendance[d.id];
      return st === 'present' || st === 'pv';
    });
    return (present.length > 0 ? present : delegates).sort((a, b) =>
      a.countryName.localeCompare(b.countryName)
    );
  }, [delegates, attendance]);

  const filteredAddList = useMemo(() => {
    const q = searchAdd.trim().toLowerCase();
    return activeDelegates.filter((d) => q === '' || d.countryName.toLowerCase().includes(q));
  }, [activeDelegates, searchAdd]);

  const currentSpeaker = caucus?.currentSpeakerId
    ? delegateMap.get(caucus.currentSpeakerId)
    : undefined;

  const queue = useMemo(
    () => dedupeSpeakerQueue(caucus?.queue || [], caucus?.currentSpeakerId),
    [caucus?.queue, caucus?.currentSpeakerId]
  );
  const defaultSpeakerSecs = caucus?.speakerSeconds || 90;
  const yieldType = caucus?.yieldType || 'none';
  const yieldTargetId = caucus?.yieldTargetId || '';

  const handleToggleTimer = async () => {
    if (!caucus) return;
    if (caucus.timerRunning) {
      await onUpdateCaucus({
        timerRunning: false,
        speakerRemainingSeconds: liveSpeakerSeconds,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        timerRunning: true,
        speakerRemainingSeconds: liveSpeakerSeconds > 0 ? liveSpeakerSeconds : defaultSpeakerSecs,
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

  const handleAddToQueue = async (delegateId: string) => {
    if (!caucus) return;
    if (isCountryInSpeakerList(delegateId, caucus.currentSpeakerId, queue, delegateMap)) {
      return;
    }
    if (!caucus.currentSpeakerId) {
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

  const handleMoveQueue = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= queue.length) return;
    const copy = [...queue];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    await onUpdateCaucus({ queue: copy });
  };

  const handleRemoveFromQueue = async (index: number) => {
    const copy = [...queue];
    copy.splice(index, 1);
    await onUpdateCaucus({ queue: copy });
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
          yieldType: 'none',
          yieldTargetId: '',
          timerUpdatedAtMs: Date.now(),
        });
      }
      return;
    }

    const elapsed = Math.max(1, defaultSpeakerSecs - liveSpeakerSeconds);
    const yieldTargetName = yieldTargetId ? delegateMap.get(yieldTargetId)?.countryName || '' : '';

    await onCompleteSpeaker({
      speakerId: currentSpeaker.id,
      speakerName: currentSpeaker.countryName,
      durationSeconds: elapsed,
      yieldType,
      yieldTargetName,
      note: speechNote.trim(),
      nextSpeakerId: nextId,
      nextQueue: restQueue,
    });
    setSpeechNote('');
  };

  const handleRecordPoi = async () => {
    if (!currentSpeaker) return;
    const qId = poiQuestionerId || activeDelegates.find((d) => d.id !== currentSpeaker.id)?.id;
    const questioner = qId ? delegateMap.get(qId) : undefined;
    if (!questioner) return;

    await onLogPoi(questioner, currentSpeaker.countryName, poiNote.trim());
    setPoiNote('');
    setPoiFlash(`POI logged for ${questioner.countryName}`);
    setTimeout(() => setPoiFlash(null), 2000);
  };

  return (
    <div className="h-full min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
      {/* Left Column: Active Speaker Stage & Yields/POIs */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5 xl:h-full min-h-0 xl:overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              General Speakers&apos; List Stage
            </h3>
            <p className="text-xs text-slate-500">
              Continuous formal debate with yields, speech notes, and Points of Information
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">Presets:</span>
            {[60, 90, 120].map((secs) => (
              <button
                key={secs}
                type="button"
                onClick={() => handleChangeDefaultTime(secs)}
                className={`px-2.5 py-1 font-mono-tabular font-semibold rounded-md transition-colors cursor-pointer ${
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

        {/* Active Speaker & Editable Countdown */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="space-y-1.5 min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Current Speaker
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
                    Speeches so far: {currentSpeaker.speechesCount}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Select or add a delegate from the Speakers&apos; List queue to take the floor.
              </div>
            )}
          </div>

          <div className="text-left sm:text-right shrink-0">
            <EditableTimer
              seconds={liveSpeakerSeconds}
              maxSeconds={600}
              size="lg"
              warningThreshold={15}
              onCommitSeconds={handleCommitCustomTime}
            />
            <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
              limit {formatClock(defaultSpeakerSecs)}
            </div>
          </div>
        </div>

        {/* Live Note for Current Speech */}
        <div className="space-y-1.5">
          <label
            htmlFor="gsl-speech-note"
            className="block text-xs font-semibold text-slate-700"
          >
            Speech Note (saved separately with this speech)
          </label>
          <textarea
            id="gsl-speech-note"
            rows={2}
            maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
            disabled={!currentSpeaker}
            value={speechNote}
            onChange={(e) => setSpeechNote(e.target.value)}
            placeholder={
              currentSpeaker
                ? `Notes for ${currentSpeaker.countryName}'s speech...`
                : 'Select a speaker to record notes for their speech...'
            }
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
          />
        </div>

        {/* Timer Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
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
            Reset
          </button>

          <button
            type="button"
            disabled={!currentSpeaker && queue.length === 0}
            onClick={handleCompleteAndNext}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors ml-auto cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
            Log Speech &amp; Next
          </button>
        </div>

        {/* Thai MUN Yields Bar */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Yield Remaining Time
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'none', label: 'None' },
                  { key: 'chair', label: 'To Chair' },
                  { key: 'pois', label: 'To POIs' },
                  { key: 'delegate', label: 'To Delegate' },
                  { key: 'comments', label: 'To Comments' },
                ] as const
              ).map((y) => (
                <button
                  key={y.key}
                  type="button"
                  onClick={() =>
                    onUpdateCaucus({
                      yieldType: y.key,
                      yieldTargetId: y.key === 'delegate' ? yieldTargetId : '',
                    })
                  }
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    yieldType === y.key
                      ? 'bg-[#0047AB] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {y.label}
                </button>
              ))}
            </div>
          </div>

          {yieldType === 'delegate' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">Yield to:</span>
              <select
                value={yieldTargetId}
                onChange={(e) => onUpdateCaucus({ yieldTargetId: e.target.value })}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="">Select delegation...</option>
                {activeDelegates
                  .filter((d) => d.id !== currentSpeaker?.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.countryName}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {/* Live POI Logger with Dedicated POI Note */}
        <div className="pt-4 border-t border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              Log Point of Information (POI) on Floor
            </span>
            {poiFlash && (
              <span className="text-xs font-medium text-green-700">{poiFlash}</span>
            )}
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <select
              aria-label="Select delegate asking POI"
              value={poiQuestionerId}
              onChange={(e) => setPoiQuestionerId(e.target.value)}
              disabled={!currentSpeaker}
              className="sm:w-52 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:opacity-50"
            >
              <option value="">Select questioning delegation...</option>
              {activeDelegates
                .filter((d) => d.id !== currentSpeaker?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.countryName} (POIs: {d.poisCount})
                  </option>
                ))}
            </select>
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
              disabled={!currentSpeaker}
              value={poiNote}
              onChange={(e) => setPoiNote(e.target.value)}
              placeholder="Note for this POI (optional)..."
              className="flex-1 min-w-[160px] px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!currentSpeaker || (!poiQuestionerId && activeDelegates.length <= 1)}
              onClick={handleRecordPoi}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              + Log POI
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Speaker Queue & Quick Add */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 xl:h-full min-h-0 xl:overflow-hidden">
        <div className="flex-1 min-h-[160px] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Speakers&apos; List Queue ({queue.length})
            </h3>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdateCaucus({ queue: [] })}
                className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
              >
                Clear Queue
              </button>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-500">
              Queue is empty. Tap any Present delegation below to add them.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {queue.map((delId, idx) => {
                const del = delegateMap.get(delId);
                if (!del) return null;
                return (
                  <div
                    key={`${delId}_${idx}`}
                    className="px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono-tabular text-xs text-slate-400 w-4">
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

        <div className="pt-3 border-t border-slate-100 flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Add Delegation to GSL
            </span>
            <input
              type="text"
              value={searchAdd}
              onChange={(e) => setSearchAdd(e.target.value)}
              placeholder="Filter..."
              className="w-36 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-[#0047AB]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
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
                      : `Add ${d.countryName} to GSL`
                  }
                  className={`px-2.5 py-1.5 border rounded-lg flex items-center justify-between gap-1.5 text-left transition-colors ${
                    alreadyListed
                      ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                      : 'bg-slate-50 hover:bg-blue-50 border-slate-200 hover:border-blue-300 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
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
