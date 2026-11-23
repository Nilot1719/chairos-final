import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  MessageSquarePlus,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react';
import type {
  ActivityLog,
  AttendanceStatus,
  CaucusState,
  Delegate,
  ResolutionSpeechCategory,
  ResolutionSubMode,
  YieldType,
} from '../../types/mun';
import {
  BLUEPRINT_BOUNDS,
  RESOLUTION_SPEECH_CATEGORIES,
  formatClock,
} from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';
import { EditableTimer } from '../EditableTimer';

interface ResolutionsTabProps {
  caucus: CaucusState | undefined;
  liveTotalSeconds: number;
  liveSpeakerSeconds: number;
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  logs: ActivityLog[];
  onUpdateCaucus: (patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>) => Promise<void>;
  onCompleteSpeech: (params: {
    speakerId: string;
    speakerName: string;
    topic: string;
    durationSeconds: number;
    yieldType: YieldType;
    yieldTargetName: string;
    note: string;
    speechCategory: ResolutionSpeechCategory;
    nextSpeakerId: string;
    nextQueue: string[];
  }) => Promise<void>;
  onLogPoi: (questioner: Delegate, targetName: string, topic: string, note: string) => Promise<void>;
  onLogAmendment: (params: {
    delegateId: string;
    delegateName: string;
    passed: boolean;
    topic: string;
    note: string;
  }) => Promise<void>;
}

export function ResolutionsTab({
  caucus,
  liveTotalSeconds,
  liveSpeakerSeconds,
  delegates,
  attendance,
  logs,
  onUpdateCaucus,
  onCompleteSpeech,
  onLogPoi,
  onLogAmendment,
}: ResolutionsTabProps) {
  const subMode: ResolutionSubMode = caucus?.subMode || 'speech';
  const rawCategory = caucus?.speechCategory as string | undefined;
  const speechCategory: ResolutionSpeechCategory =
    rawCategory &&
    RESOLUTION_SPEECH_CATEGORIES.some((item) => item.key === rawCategory)
      ? (rawCategory as ResolutionSpeechCategory)
      : 'main_sub';

  const [topicDraft, setTopicDraft] = useState(caucus?.topic || '');
  const [speechNote, setSpeechNote] = useState('');
  const [poiQuestionerId, setPoiQuestionerId] = useState('');
  const [poiNote, setPoiNote] = useState('');
  const [poiFlash, setPoiFlash] = useState<string | null>(null);
  const [searchAdd, setSearchAdd] = useState('');

  // Amendment Counter Form State
  const [amendDelegateId, setAmendDelegateId] = useState('');
  const [amendRef, setAmendRef] = useState('');
  const [amendNote, setAmendNote] = useState('');
  const [amendFlash, setAmendFlash] = useState<string | null>(null);

  useEffect(() => {
    setTopicDraft(caucus?.topic || '');
  }, [caucus?.topic]);

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

  const resolutionLogs = useMemo(
    () => logs.filter((l) => l.caucusMode === 'Resolutions').slice(0, 20),
    [logs]
  );

  const currentSpeaker = caucus?.currentSpeakerId
    ? delegateMap.get(caucus.currentSpeakerId)
    : undefined;
  const queue = caucus?.queue || [];
  const defaultSpeakerSecs = caucus?.speakerSeconds || 90;
  const totalReadingSecs = caucus?.totalSeconds || 180;
  const yieldType = caucus?.yieldType || 'none';
  const yieldTargetId = caucus?.yieldTargetId || '';

  const handleSwitchSubMode = async (nextMode: ResolutionSubMode) => {
    await onUpdateCaucus({
      subMode: nextMode,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleToggleReadingTimer = async () => {
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
        totalRemainingSeconds: liveTotalSeconds > 0 ? liveTotalSeconds : totalReadingSecs,
        timerUpdatedAtMs: Date.now(),
      });
    }
  };

  const handleToggleSpeechTimer = async () => {
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

  const handleAddToQueue = async (delegateId: string) => {
    if (!caucus) return;
    if (!caucus.currentSpeakerId) {
      await onUpdateCaucus({
        currentSpeakerId: delegateId,
        speakerRemainingSeconds: defaultSpeakerSecs,
        timerRunning: false,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({ queue: [...queue, delegateId] });
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
    const [nextId = '', ...rest] = queue;
    if (!currentSpeaker) {
      if (nextId) {
        await onUpdateCaucus({
          currentSpeakerId: nextId,
          queue: rest,
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

    await onCompleteSpeech({
      speakerId: currentSpeaker.id,
      speakerName: currentSpeaker.countryName,
      topic: topicDraft.trim() || caucus?.topic || 'Resolutions Debate',
      durationSeconds: elapsed,
      yieldType,
      yieldTargetName,
      note: speechNote.trim(),
      speechCategory,
      nextSpeakerId: nextId,
      nextQueue: rest,
    });
    setSpeechNote('');
  };

  const handleRecordPoi = async () => {
    if (!currentSpeaker) return;
    const qId = poiQuestionerId || activeDelegates.find((d) => d.id !== currentSpeaker.id)?.id;
    const questioner = qId ? delegateMap.get(qId) : undefined;
    if (!questioner) return;

    await onLogPoi(
      questioner,
      currentSpeaker.countryName,
      topicDraft.trim() || caucus?.topic || 'Resolutions Debate',
      poiNote.trim()
    );
    setPoiNote('');
    setPoiFlash(`POI logged for ${questioner.countryName}`);
    setTimeout(() => setPoiFlash(null), 2000);
  };

  const handleRecordAmendment = async (passed: boolean) => {
    const targetId = amendDelegateId || activeDelegates[0]?.id;
    const del = targetId ? delegateMap.get(targetId) : undefined;
    if (!del) return;

    await onLogAmendment({
      delegateId: del.id,
      delegateName: del.countryName,
      passed,
      topic: amendRef.trim() || topicDraft.trim() || 'Draft Resolution Amendment',
      note: amendNote.trim(),
    });
    setAmendRef('');
    setAmendNote('');
    setAmendFlash(`Amendment (${passed ? 'Passed' : 'Failed'}) logged for ${del.countryName}`);
    setTimeout(() => setAmendFlash(null), 2500);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Top Bar: Mode Toggle + Free-text Topic/Stage */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => handleSwitchSubMode('speech')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subMode === 'speech'
                ? 'bg-white text-[#0047AB] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Speech Mode
          </button>
          <button
            type="button"
            onClick={() => handleSwitchSubMode('reading')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subMode === 'reading'
                ? 'bg-white text-[#0047AB] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Reading/Amendment Writing
          </button>
        </div>

        <div className="flex-1 min-w-[260px] flex items-center gap-2">
          <input
            type="text"
            maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            placeholder="Topic / Stage (e.g., Main Sub Speech, Amendment 1 For/Against, DR 1.1)..."
            className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
          />
          <button
            type="button"
            onClick={() => onUpdateCaucus({ topic: topicDraft.trim() })}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer whitespace-nowrap"
          >
            Set Label
          </button>
        </div>
      </div>

      {/* Main Content */}
      {subMode === 'reading' ? (
        <div className="flex-1 min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
          {/* Speaker-Free Reading/Amendment Writing Timer Stage */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6 xl:h-full min-h-0 xl:overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Reading/Amendment Writing
                </h3>
                <p className="text-xs text-slate-500">
                  Speaker-free timer for silent reading or drafting amendments
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {[2, 3, 5, 10].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      onUpdateCaucus({
                        totalSeconds: m * 60,
                        totalRemainingSeconds: m * 60,
                        timerRunning: false,
                        timerUpdatedAtMs: Date.now(),
                      })
                    }
                    className={`px-2.5 py-1 text-xs font-mono-tabular font-semibold rounded-md transition-colors cursor-pointer ${
                      totalReadingSecs === m * 60
                        ? 'bg-[#0047AB] text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="py-10 px-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center text-center space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Reading/Amendment Writing Timer
              </div>
              <EditableTimer
                seconds={liveTotalSeconds}
                maxSeconds={7200}
                size="xl"
                warningThreshold={30}
                onCommitSeconds={async (secs) => {
                  await onUpdateCaucus({
                    totalSeconds: secs > 0 ? secs : totalReadingSecs,
                    totalRemainingSeconds: secs,
                    timerRunning: false,
                    timerUpdatedAtMs: Date.now(),
                  });
                }}
              />
              <div className="text-xs text-slate-500 font-mono-tabular">
                of {formatClock(totalReadingSecs)}
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleToggleReadingTimer}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors cursor-pointer"
              >
                {caucus?.timerRunning ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pause Timer
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Timer
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateCaucus({
                    timerRunning: false,
                    totalRemainingSeconds: totalReadingSecs,
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

          {/* Amendment Counter & Log */}
          <div className="xl:col-span-5 space-y-5 xl:h-full min-h-0 xl:overflow-y-auto pr-0.5">
            <AmendmentCounterCard
              activeDelegates={activeDelegates}
              amendDelegateId={amendDelegateId}
              setAmendDelegateId={setAmendDelegateId}
              amendRef={amendRef}
              setAmendRef={setAmendRef}
              amendNote={amendNote}
              setAmendNote={setAmendNote}
              amendFlash={amendFlash}
              onRecord={handleRecordAmendment}
            />
            <ResolutionLogsCard logs={resolutionLogs} />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
          {/* Left Column: Speech Stage + Yields + POIs */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5 xl:h-full min-h-0 xl:overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-700">Speech Type Tracked</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {RESOLUTION_SPEECH_CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => onUpdateCaucus({ speechCategory: cat.key })}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        speechCategory === cat.key
                          ? 'bg-[#0047AB] text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Presets:</span>
                {[60, 90, 120, 180].map((secs) => (
                  <button
                    key={secs}
                    type="button"
                    onClick={() =>
                      onUpdateCaucus({
                        speakerSeconds: secs,
                        speakerRemainingSeconds: secs,
                        timerRunning: false,
                        timerUpdatedAtMs: Date.now(),
                      })
                    }
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

            {/* Speaker + Editable Timer */}
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
                        Total Speeches: {currentSpeaker.speechesCount} · Main Sub:{' '}
                        {currentSpeaker.mainSubSpeechesCount || 0} · Amend:{' '}
                        {currentSpeaker.amendmentSpeechesCount || 0}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    Select a delegation on the right to take the floor.
                  </div>
                )}
              </div>

              <div className="text-left sm:text-right shrink-0">
                <EditableTimer
                  seconds={liveSpeakerSeconds}
                  maxSeconds={600}
                  size="lg"
                  warningThreshold={15}
                  onCommitSeconds={async (secs) => {
                    await onUpdateCaucus({
                      speakerSeconds: secs > 0 ? secs : defaultSpeakerSecs,
                      speakerRemainingSeconds: secs,
                      timerRunning: false,
                      timerUpdatedAtMs: Date.now(),
                    });
                  }}
                />
                <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                  limit {formatClock(defaultSpeakerSecs)}
                </div>
              </div>
            </div>

            {/* Live Speech Note */}
            <div className="space-y-1.5">
              <label
                htmlFor="res-speech-note"
                className="block text-xs font-semibold text-slate-700"
              >
                Speech Note (saved separately with this speech)
              </label>
              <textarea
                id="res-speech-note"
                rows={2}
                maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
                disabled={!currentSpeaker}
                value={speechNote}
                onChange={(e) => setSpeechNote(e.target.value)}
                placeholder={
                  currentSpeaker
                    ? `Notes for ${currentSpeaker.countryName}'s speech...`
                    : 'Select a speaker to record notes...'
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
              />
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={!currentSpeaker}
                onClick={handleToggleSpeechTimer}
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
                onClick={() =>
                  onUpdateCaucus({
                    timerRunning: false,
                    speakerRemainingSeconds: defaultSpeakerSecs,
                    timerUpdatedAtMs: Date.now(),
                  })
                }
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

            {/* Yields */}
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">Yield Remaining Time</span>
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

            {/* POI Logger */}
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Log Point of Information (POI)
                </span>
                {poiFlash && <span className="text-xs font-medium text-green-700">{poiFlash}</span>}
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <select
                  aria-label="Select delegate asking POI"
                  value={poiQuestionerId}
                  onChange={(e) => setPoiQuestionerId(e.target.value)}
                  disabled={!currentSpeaker}
                  className="sm:w-48 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:opacity-50"
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
                  className="flex-1 min-w-[150px] px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
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

          {/* Right Column: Queue + Recognize + Amendment Counter */}
          <div className="xl:col-span-5 space-y-5 xl:h-full min-h-0 xl:overflow-y-auto pr-0.5">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-display text-sm font-bold text-slate-900">
                    Resolution Speakers Queue ({queue.length})
                  </h4>
                  {queue.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onUpdateCaucus({ queue: [] })}
                      className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {queue.length === 0 ? (
                  <p className="text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-3 text-center">
                    Queue empty. Tap a delegation below to recognize or enqueue.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                    {queue.map((id, idx) => {
                      const del = delegateMap.get(id);
                      if (!del) return null;
                      return (
                        <div
                          key={`${id}_${idx}`}
                          className="px-3 py-1.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono-tabular text-xs text-slate-400">
                              {idx + 1}.
                            </span>
                            <CountryFlag code={del.countryCode} name={del.countryName} size="sm" />
                            <span className="text-xs font-medium text-slate-800 truncate">
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

              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Add Delegation
                  </span>
                  <input
                    type="text"
                    value={searchAdd}
                    onChange={(e) => setSearchAdd(e.target.value)}
                    placeholder="Filter..."
                    className="w-32 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                  {filteredAddList.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => handleAddToQueue(d.id)}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg flex items-center gap-2 text-left transition-colors cursor-pointer"
                    >
                      <CountryFlag code={d.countryCode} name={d.countryName} size="sm" />
                      <span className="text-xs font-medium text-slate-800 truncate">
                        {d.countryName}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <AmendmentCounterCard
              activeDelegates={activeDelegates}
              amendDelegateId={amendDelegateId}
              setAmendDelegateId={setAmendDelegateId}
              amendRef={amendRef}
              setAmendRef={setAmendRef}
              amendNote={amendNote}
              setAmendNote={setAmendNote}
              amendFlash={amendFlash}
              onRecord={handleRecordAmendment}
            />

            <ResolutionLogsCard logs={resolutionLogs} />
          </div>
        </div>
      )}
    </div>
  );
}

function AmendmentCounterCard({
  activeDelegates,
  amendDelegateId,
  setAmendDelegateId,
  amendRef,
  setAmendRef,
  amendNote,
  setAmendNote,
  amendFlash,
  onRecord,
}: {
  activeDelegates: Delegate[];
  amendDelegateId: string;
  setAmendDelegateId: (v: string) => void;
  amendRef: string;
  setAmendRef: (v: string) => void;
  amendNote: string;
  setAmendNote: (v: string) => void;
  amendFlash: string | null;
  onRecord: (passed: boolean) => Promise<void>;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-bold text-slate-900">
          Amendment Outcome Counter
        </h4>
        {amendFlash && (
          <span className="text-[11px] font-semibold text-green-700">{amendFlash}</span>
        )}
      </div>

      <div className="space-y-2.5">
        <select
          aria-label="Amendment proposing delegation"
          value={amendDelegateId || activeDelegates[0]?.id || ''}
          onChange={(e) => setAmendDelegateId(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
        >
          {activeDelegates.map((d) => (
            <option key={d.id} value={d.id}>
              {d.countryName} (Proposed: {d.amendmentsProposedCount || 0} · Passed:{' '}
              {d.amendmentsPassedCount || 0})
            </option>
          ))}
        </select>

        <input
          type="text"
          maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
          value={amendRef}
          onChange={(e) => setAmendRef(e.target.value)}
          placeholder="Amendment label (e.g., Amend Clause 3.2)..."
          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
        />

        <input
          type="text"
          maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
          value={amendNote}
          onChange={(e) => setAmendNote(e.target.value)}
          placeholder="Note on amendment outcome (optional)..."
          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={activeDelegates.length === 0}
            onClick={() => onRecord(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Log Passed
          </button>
          <button
            type="button"
            disabled={activeDelegates.length === 0}
            onClick={() => onRecord(false)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Log Failed
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolutionLogsCard({ logs }: { logs: ActivityLog[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-display text-sm font-bold text-slate-900">
          Resolutions &amp; Amendments Feed
        </h4>
        <span className="text-xs font-mono-tabular text-slate-500">
          {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {logs.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-500">
          No resolution speeches, POIs, or amendments logged yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-60 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="px-3 py-2 space-y-0.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {log.delegateName}{' '}
                  <span className="font-medium text-[#0047AB] uppercase">
                    ({log.type} · {log.outcome.replace(/_/g, ' ')})
                  </span>
                </span>
                {log.durationSeconds > 0 && (
                  <span className="font-mono-tabular text-slate-500">
                    {formatClock(log.durationSeconds)}
                  </span>
                )}
              </div>
              {log.topic && <div className="text-slate-700">{log.topic}</div>}
              {log.note && <div className="text-slate-500">{log.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
