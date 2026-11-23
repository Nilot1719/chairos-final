import React, { useMemo, useState } from 'react';
import {
  MessageSquarePlus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SkipForward,
  X,
} from 'lucide-react';
import type { AttendanceStatus, CaucusState, Delegate } from '../../types/mun';
import { BLUEPRINT_BOUNDS, formatClock } from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';
import { EditableTimer } from '../EditableTimer';

interface ModTabProps {
  caucus: CaucusState | undefined;
  liveTotalSeconds: number;
  liveSpeakerSeconds: number;
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  onUpdateCaucus: (patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>) => Promise<void>;
  onCompleteSpeaker: (params: {
    speakerId: string;
    speakerName: string;
    topic: string;
    durationSeconds: number;
    note: string;
    nextSpeakerId: string;
    nextQueue: string[];
    newTotalRemaining: number;
    newSlotsUsed: number;
  }) => Promise<void>;
  onLogPoi: (questioner: Delegate, targetName: string, topic: string, note: string) => Promise<void>;
}

export function ModTab({
  caucus,
  liveTotalSeconds,
  liveSpeakerSeconds,
  delegates,
  attendance,
  onUpdateCaucus,
  onCompleteSpeaker,
  onLogPoi,
}: ModTabProps) {
  const [editingSetup, setEditingSetup] = useState(false);
  const [setupTopic, setSetupTopic] = useState('');
  const [setupTotalMin, setSetupTotalMin] = useState(10);
  const [setupSpeakerSec, setSetupSpeakerSec] = useState(60);
  const [speechNote, setSpeechNote] = useState('');
  const [poiQuestionerId, setPoiQuestionerId] = useState('');
  const [poiNote, setPoiNote] = useState('');
  const [poiFlash, setPoiFlash] = useState<string | null>(null);
  const [searchDel, setSearchDel] = useState('');

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

  const filteredDelegates = useMemo(() => {
    const q = searchDel.trim().toLowerCase();
    return activeDelegates.filter((d) => q === '' || d.countryName.toLowerCase().includes(q));
  }, [activeDelegates, searchDel]);

  const totalSecs = caucus?.totalSeconds || 600;
  const speakerSecs = caucus?.speakerSeconds || 60;
  const maxSlots = speakerSecs > 0 ? Math.floor(totalSecs / speakerSecs) : 0;
  const slotsUsed = caucus?.slotsUsed || 0;
  const queue = caucus?.queue || [];
  const currentSpeaker = caucus?.currentSpeakerId
    ? delegateMap.get(caucus.currentSpeakerId)
    : undefined;

  const openSetup = () => {
    setSetupTopic(caucus?.topic || '');
    setSetupTotalMin(Math.max(1, Math.round(totalSecs / 60)));
    setSetupSpeakerSec(speakerSecs || 60);
    setEditingSetup(true);
  };

  const handleSaveSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const newTotal = Math.max(60, Math.min(7200, setupTotalMin * 60));
    const newSpk = Math.max(15, Math.min(600, setupSpeakerSec));
    await onUpdateCaucus({
      topic: setupTopic.trim() || 'Moderated Caucus',
      totalSeconds: newTotal,
      speakerSeconds: newSpk,
      totalRemainingSeconds: newTotal,
      speakerRemainingSeconds: newSpk,
      timerRunning: false,
      timerUpdatedAtMs: Date.now(),
      slotsUsed: 0,
      queue: [],
      currentSpeakerId: '',
    });
    setEditingSetup(false);
  };

  const handleToggleTimers = async () => {
    if (!caucus) return;
    if (caucus.timerRunning) {
      await onUpdateCaucus({
        timerRunning: false,
        totalRemainingSeconds: liveTotalSeconds,
        speakerRemainingSeconds: liveSpeakerSeconds,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        timerRunning: true,
        totalRemainingSeconds: liveTotalSeconds > 0 ? liveTotalSeconds : totalSecs,
        speakerRemainingSeconds: liveSpeakerSeconds > 0 ? liveSpeakerSeconds : speakerSecs,
        timerUpdatedAtMs: Date.now(),
      });
    }
  };

  const handleExtendMod = async (addSeconds: number) => {
    await onUpdateCaucus({
      totalSeconds: Math.min(7200, totalSecs + addSeconds),
      totalRemainingSeconds: Math.min(7200, liveTotalSeconds + addSeconds),
      timerUpdatedAtMs: Date.now(),
    });
  };

  const handleRecognizeDelegate = async (delegateId: string) => {
    if (!caucus) return;
    if (!caucus.currentSpeakerId) {
      await onUpdateCaucus({
        currentSpeakerId: delegateId,
        speakerRemainingSeconds: speakerSecs,
        timerRunning: false,
        timerUpdatedAtMs: Date.now(),
      });
    } else {
      await onUpdateCaucus({
        queue: [...queue, delegateId],
      });
    }
  };

  const handleRemoveQueued = async (idx: number) => {
    const copy = [...queue];
    copy.splice(idx, 1);
    await onUpdateCaucus({ queue: copy });
  };

  const handleCompleteAndNext = async () => {
    const [nextId = '', ...rest] = queue;
    if (!currentSpeaker) {
      if (nextId) {
        await onUpdateCaucus({
          currentSpeakerId: nextId,
          queue: rest,
          speakerRemainingSeconds: speakerSecs,
          totalRemainingSeconds: liveTotalSeconds,
          timerRunning: false,
          timerUpdatedAtMs: Date.now(),
        });
      }
      return;
    }

    const elapsed = Math.max(1, speakerSecs - liveSpeakerSeconds);
    await onCompleteSpeaker({
      speakerId: currentSpeaker.id,
      speakerName: currentSpeaker.countryName,
      topic: caucus?.topic || 'Moderated Caucus',
      durationSeconds: elapsed,
      note: speechNote.trim(),
      nextSpeakerId: nextId,
      nextQueue: rest,
      newTotalRemaining: liveTotalSeconds,
      newSlotsUsed: slotsUsed + 1,
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
      caucus?.topic || 'Moderated Caucus',
      poiNote.trim()
    );
    setPoiNote('');
    setPoiFlash(`POI logged for ${questioner.countryName}`);
    setTimeout(() => setPoiFlash(null), 2000);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Mod Header Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#0047AB]">Moderated Caucus</div>
            <h3 className="font-display text-lg font-bold text-slate-900 truncate">
              {caucus?.topic || 'No active topic configured'}
            </h3>
            <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
              Total: {formatClock(totalSecs)} · Speaker: {formatClock(speakerSecs)} · Slots Used: {slotsUsed}/{maxSlots || '—'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleExtendMod(120)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              2m
            </button>
            <button
              type="button"
              onClick={() => handleExtendMod(300)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              5m
            </button>
            <button
              type="button"
              onClick={openSetup}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Configure Mod
            </button>
          </div>
        </div>

        {editingSetup && (
          <form
            onSubmit={handleSaveSetup}
            className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <div className="sm:col-span-6">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Moderated Caucus Topic
              </label>
              <input
                type="text"
                maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
                value={setupTopic}
                onChange={(e) => setSetupTopic(e.target.value)}
                placeholder="e.g., Border carbon adjustments"
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Total (min)
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={setupTotalMin}
                onChange={(e) => setSetupTotalMin(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Speaker (sec)
              </label>
              <input
                type="number"
                min={15}
                max={600}
                step={15}
                value={setupSpeakerSec}
                onChange={(e) => setSetupSpeakerSec(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer"
              >
                Start Mod
              </button>
              <button
                type="button"
                onClick={() => setEditingSetup(false)}
                className="px-2.5 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Main Split: Dual Timers Stage & Recognition Grid */}
      <div className="flex-1 min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5 xl:h-full min-h-0 xl:overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <EditableTimer
                label="Speaker Timer"
                seconds={liveSpeakerSeconds}
                maxSeconds={600}
                size="lg"
                warningThreshold={10}
                onCommitSeconds={async (secs) => {
                  await onUpdateCaucus({
                    speakerSeconds: secs > 0 ? secs : speakerSecs,
                    speakerRemainingSeconds: secs,
                    timerRunning: false,
                    timerUpdatedAtMs: Date.now(),
                  });
                }}
              />
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <EditableTimer
                label="Total Caucus Remaining"
                seconds={liveTotalSeconds}
                maxSeconds={7200}
                size="lg"
                warningThreshold={30}
                onCommitSeconds={async (secs) => {
                  await onUpdateCaucus({
                    totalSeconds: Math.max(totalSecs, secs),
                    totalRemainingSeconds: secs,
                    timerRunning: false,
                    timerUpdatedAtMs: Date.now(),
                  });
                }}
              />
            </div>
          </div>

          <div className="p-4 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Recognized Speaker
              </div>
              {currentSpeaker ? (
                <div className="flex items-center gap-3">
                  <CountryFlag
                    code={currentSpeaker.countryCode}
                    name={currentSpeaker.countryName}
                    size="lg"
                  />
                  <span className="font-display text-xl font-bold text-slate-900">
                    {currentSpeaker.countryName}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-slate-500">
                  Tap a delegation on the right to recognize speaker
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!currentSpeaker}
                onClick={handleToggleTimers}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {caucus?.timerRunning ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!currentSpeaker}
                onClick={() =>
                  onUpdateCaucus({
                    speakerRemainingSeconds: speakerSecs,
                    timerRunning: false,
                    timerUpdatedAtMs: Date.now(),
                  })
                }
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Speaker
              </button>
              <button
                type="button"
                disabled={!currentSpeaker && queue.length === 0}
                onClick={handleCompleteAndNext}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
                Log &amp; Next
              </button>
            </div>
          </div>

          {/* Speech Note Box */}
          <div className="space-y-1.5">
            <label
              htmlFor="mod-speech-note"
              className="block text-xs font-semibold text-slate-700"
            >
              Speech Note (saved separately with this speech)
            </label>
            <textarea
              id="mod-speech-note"
              rows={2}
              maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
              disabled={!currentSpeaker}
              value={speechNote}
              onChange={(e) => setSpeechNote(e.target.value)}
              placeholder={
                currentSpeaker
                  ? `Notes for ${currentSpeaker.countryName}'s speech...`
                  : 'Recognize a speaker to record notes for their speech...'
              }
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB] disabled:opacity-50"
            />
          </div>

          {/* Optional Thai MUN POI during Mod */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Quick POI (if allowed/yielded)
              </span>
              {poiFlash && <span className="text-xs font-medium text-green-700">{poiFlash}</span>}
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <select
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
                      {d.countryName}
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
                disabled={!currentSpeaker}
                onClick={handleRecordPoi}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                + Log POI
              </button>
            </div>
          </div>
        </div>

        {/* Right: Mod Queue & Recognition */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 xl:h-full min-h-0 xl:overflow-hidden">
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-display text-sm font-bold text-slate-900">
                Mod Queue ({queue.length})
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
                No queued speakers yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-36 overflow-y-auto">
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
                      <button
                        type="button"
                        onClick={() => handleRemoveQueued(idx)}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex-1 min-h-[160px] flex flex-col gap-2.5 overflow-hidden">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs font-semibold text-slate-700">
                Recognize Placard
              </span>
              <input
                type="text"
                value={searchDel}
                onChange={(e) => setSearchDel(e.target.value)}
                placeholder="Filter..."
                className="w-32 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-1.5 content-start pr-0.5">
              {filteredDelegates.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleRecognizeDelegate(d.id)}
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
      </div>
    </div>
  );
}
