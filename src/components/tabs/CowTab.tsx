import { useMemo, useState } from 'react';
import { Pause, Play, Plus, RotateCcw, Square } from 'lucide-react';
import type { ActivityLog, AttendanceStatus, CaucusState, Delegate } from '../../types/mun';
import { BLUEPRINT_BOUNDS, formatClock } from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';
import { EditableTimer } from '../EditableTimer';

interface CowTabProps {
  caucus: CaucusState | undefined;
  liveTotalSeconds: number;
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  logs: ActivityLog[];
  onUpdateCaucus: (patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>) => Promise<void>;
  onPassFloor: (params: {
    previousSpeakerId: string;
    previousSpeakerName: string;
    nextSpeakerId: string;
    topic: string;
    note: string;
    durationSeconds: number;
  }) => Promise<void>;
}

export function CowTab({
  caucus,
  liveTotalSeconds,
  delegates,
  attendance,
  logs,
  onUpdateCaucus,
  onPassFloor,
}: CowTabProps) {
  const [topicDraft, setTopicDraft] = useState(caucus?.topic || '');
  const [interventionNote, setInterventionNote] = useState('');
  const [floorStartTime, setFloorStartTime] = useState<number>(() => Date.now());
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

  const cowLogs = useMemo(
    () => logs.filter((l) => l.caucusMode === 'COW').slice(0, 25),
    [logs]
  );

  const totalSecs = caucus?.totalSeconds || 600;
  const currentHolder = caucus?.currentSpeakerId
    ? delegateMap.get(caucus.currentSpeakerId)
    : undefined;

  const handleToggleTimer = async () => {
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

  const handlePassFloor = async (nextDelegate: Delegate) => {
    const elapsed = currentHolder
      ? Math.max(5, Math.min(600, Math.round((Date.now() - floorStartTime) / 1000)))
      : 0;

    await onPassFloor({
      previousSpeakerId: currentHolder?.id || '',
      previousSpeakerName: currentHolder?.countryName || '',
      nextSpeakerId: nextDelegate.id,
      topic: caucus?.topic || 'Consultation of a Whole',
      note: interventionNote.trim(),
      durationSeconds: elapsed,
    });

    setInterventionNote('');
    setFloorStartTime(Date.now());
  };

  const handleEndFloor = async () => {
    if (!currentHolder) return;
    const elapsed = Math.max(5, Math.min(600, Math.round((Date.now() - floorStartTime) / 1000)));
    await onPassFloor({
      previousSpeakerId: currentHolder.id,
      previousSpeakerName: currentHolder.countryName,
      nextSpeakerId: '',
      topic: caucus?.topic || 'Consultation of a Whole',
      note: interventionNote.trim(),
      durationSeconds: elapsed,
    });
    setInterventionNote('');
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Consultation of a Whole Topic & Editable Total Timer Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex-1 min-w-[240px] space-y-1">
          <div className="text-xs font-semibold text-[#0047AB]">
            Consultation of a Whole (COW · No POIs)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              placeholder="Consultation of a Whole Focus (e.g., Operative Clause 4 Amendments)"
              className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
            <button
              type="button"
              onClick={() => onUpdateCaucus({ topic: topicDraft.trim() })}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer"
            >
              Set Topic
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <EditableTimer
            seconds={liveTotalSeconds}
            maxSeconds={7200}
            size="md"
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
          <button
            type="button"
            onClick={handleToggleTimer}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg cursor-pointer"
          >
            {caucus?.timerRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Start
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              onUpdateCaucus({
                totalSeconds: Math.min(7200, totalSecs + 120),
                totalRemainingSeconds: Math.min(7200, liveTotalSeconds + 120),
                timerUpdatedAtMs: Date.now(),
              })
            }
            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            2m
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
            className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            title="Reset COW timer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Split: Active Floor Holder + Floor Passing Grid vs. Chronological Chain */}
      <div className="flex-1 min-h-0 flex flex-col xl:grid xl:grid-cols-12 gap-5 overflow-y-auto xl:overflow-hidden">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col gap-4 xl:h-full min-h-0 xl:overflow-hidden">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Currently Holding the Floor
              </span>
              {currentHolder && (
                <button
                  type="button"
                  onClick={handleEndFloor}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-md cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  End &amp; Log Intervention
                </button>
              )}
            </div>

            {currentHolder ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CountryFlag
                    code={currentHolder.countryCode}
                    name={currentHolder.countryName}
                    size="lg"
                  />
                  <div>
                    <div className="font-display text-xl font-bold text-slate-900">
                      {currentHolder.countryName}
                    </div>
                    <div className="text-xs text-slate-500">
                      Click any delegation below to log this intervention and pass the floor directly
                    </div>
                  </div>
                </div>

                <textarea
                  rows={2}
                  maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
                  value={interventionNote}
                  onChange={(e) => setInterventionNote(e.target.value)}
                  placeholder={`Note for ${currentHolder.countryName}'s intervention (logged separately when floor passes)...`}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No delegation holds the floor. Tap any delegation below to recognize the first speaker in Consultation of a Whole.
              </p>
            )}
          </div>

          {/* Floor Passing Grid (No POIs in Consultation of a Whole) */}
          <div className="flex-1 min-h-[160px] flex flex-col gap-2.5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
              <span className="text-xs font-semibold text-slate-700">
                {currentHolder ? 'Pass Floor To Next Delegation' : 'Recognize First Floor Holder'}
              </span>
              <input
                type="text"
                value={searchDel}
                onChange={(e) => setSearchDel(e.target.value)}
                placeholder="Filter..."
                className="w-36 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2 content-start pr-0.5">
              {filteredDelegates.map((d) => {
                const isHolder = d.id === currentHolder?.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={isHolder}
                    onClick={() => handlePassFloor(d)}
                    className={`p-2 rounded-lg border flex items-center gap-2 text-left transition-colors ${
                      isHolder
                        ? 'bg-blue-50 border-blue-300 cursor-default'
                        : 'bg-slate-50 border-slate-200 hover:bg-blue-50 hover:border-blue-300 cursor-pointer'
                    }`}
                  >
                    <CountryFlag code={d.countryCode} name={d.countryName} size="sm" />
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {d.countryName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Chronological Floor Chain */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 xl:h-full min-h-0 xl:overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Consultation of a Whole Log
            </h3>
            <span className="text-xs font-mono-tabular text-slate-500">
              {cowLogs.length} interventions
            </span>
          </div>

          {cowLogs.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">
              Pass the floor between delegations to build the Consultation of a Whole discussion log.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {cowLogs.map((log) => (
                <div key={log.id} className="px-3.5 py-2.5 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900">
                      {log.delegateName}
                    </span>
                    {log.durationSeconds > 0 && (
                      <span className="font-mono-tabular text-slate-500">
                        {formatClock(log.durationSeconds)}
                      </span>
                    )}
                  </div>
                  {(log.note || log.topic) && (
                    <p className="text-xs text-slate-600">{log.note || log.topic}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
