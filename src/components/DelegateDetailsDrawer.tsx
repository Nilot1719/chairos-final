import { useEffect, useState } from 'react';
import { Check, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ActivityLog, AttendanceStatus, Delegate, DelegateStatsPatch } from '../types/mun';
import { CountryFlag } from './CountryFlag';
import { BLUEPRINT_BOUNDS, formatClock } from '../lib/munRules';

interface DelegateDetailsDrawerProps {
  delegate: Delegate | null;
  attendanceStatus: AttendanceStatus;
  logs: ActivityLog[];
  onClose: () => void;
  onSaveNotes: (delegateId: string, notes: string) => Promise<void>;
  onSaveStats: (delegateId: string, stats: DelegateStatsPatch) => Promise<void>;
  onChangeAttendance: (delegateId: string, status: AttendanceStatus) => Promise<void>;
  onUpdateLogNote: (logId: string, note: string) => Promise<void>;
  onDeleteLog: (log: ActivityLog) => Promise<void>;
}

const CORE_STAT_FIELDS: Array<{
  key: keyof DelegateStatsPatch;
  label: string;
  accent?: string;
}> = [
  { key: 'speechesCount', label: 'Speeches' },
  { key: 'poisCount', label: 'POIs' },
  { key: 'motionsProposedCount', label: 'Motions Proposed' },
  { key: 'motionsAcceptedCount', label: 'Motions Passed', accent: 'text-[#0047AB]' },
];

const RESOLUTION_STAT_FIELDS: Array<{
  key: keyof DelegateStatsPatch;
  label: string;
  accent?: string;
}> = [
  { key: 'mainSubSpeechesCount', label: 'Main Sub Speeches' },
  { key: 'amendmentsProposedCount', label: 'Amendments Proposed' },
  { key: 'amendmentsPassedCount', label: 'Amendments Passed', accent: 'text-green-700' },
  { key: 'amendmentSpeechesCount', label: 'Amendment Speeches' },
];

function toStatsPatch(delegate: Delegate): DelegateStatsPatch {
  return {
    speechesCount: delegate.speechesCount || 0,
    poisCount: delegate.poisCount || 0,
    motionsProposedCount: delegate.motionsProposedCount || 0,
    motionsAcceptedCount: delegate.motionsAcceptedCount || 0,
    mainSubSpeechesCount: delegate.mainSubSpeechesCount || 0,
    amendmentsProposedCount: delegate.amendmentsProposedCount || 0,
    amendmentsPassedCount: delegate.amendmentsPassedCount || 0,
    amendmentSpeechesCount: delegate.amendmentSpeechesCount || 0,
  };
}

export function DelegateDetailsDrawer({
  delegate,
  attendanceStatus,
  logs,
  onClose,
  onSaveNotes,
  onSaveStats,
  onChangeAttendance,
  onUpdateLogNote,
  onDeleteLog,
}: DelegateDetailsDrawerProps) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [statsDraft, setStatsDraft] = useState<DelegateStatsPatch>({
    speechesCount: 0,
    poisCount: 0,
    motionsProposedCount: 0,
    motionsAcceptedCount: 0,
    mainSubSpeechesCount: 0,
    amendmentsProposedCount: 0,
    amendmentsPassedCount: 0,
    amendmentSpeechesCount: 0,
  });
  const [savingStats, setSavingStats] = useState(false);
  const [statsSavedNotice, setStatsSavedNotice] = useState(false);

  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logNoteDraft, setLogNoteDraft] = useState('');
  const [savingLogId, setSavingLogId] = useState<string | null>(null);

  useEffect(() => {
    if (delegate) {
      setNotes(delegate.chairNotes || '');
      setStatsDraft(toStatsPatch(delegate));
      setSavedNotice(false);
      setStatsSavedNotice(false);
      setEditingLogId(null);
      setLogNoteDraft('');
    }
  }, [delegate]);

  if (!delegate) return null;

  const delegateLogs = logs.filter((l) => l.delegateId === delegate.id);
  const totalScore =
    statsDraft.speechesCount +
    statsDraft.poisCount +
    statsDraft.motionsProposedCount +
    statsDraft.amendmentsProposedCount;

  const statsDirty =
    statsDraft.speechesCount !== (delegate.speechesCount || 0) ||
    statsDraft.poisCount !== (delegate.poisCount || 0) ||
    statsDraft.motionsProposedCount !== (delegate.motionsProposedCount || 0) ||
    statsDraft.motionsAcceptedCount !== (delegate.motionsAcceptedCount || 0) ||
    statsDraft.mainSubSpeechesCount !== (delegate.mainSubSpeechesCount || 0) ||
    statsDraft.amendmentsProposedCount !== (delegate.amendmentsProposedCount || 0) ||
    statsDraft.amendmentsPassedCount !== (delegate.amendmentsPassedCount || 0) ||
    statsDraft.amendmentSpeechesCount !== (delegate.amendmentSpeechesCount || 0);

  const setStatValue = (key: keyof DelegateStatsPatch, next: number) => {
    const clamped = Math.max(0, Math.min(10000, Math.round(Number.isFinite(next) ? next : 0)));
    setStatsDraft((prev) => ({ ...prev, [key]: clamped }));
    setStatsSavedNotice(false);
  };

  const handleSaveStats = async () => {
    setSavingStats(true);
    try {
      await onSaveStats(delegate.id, statsDraft);
      setStatsSavedNotice(true);
      setTimeout(() => setStatsSavedNotice(false), 2000);
    } finally {
      setSavingStats(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveNotes(delegate.id, notes);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLogNote = async (logId: string) => {
    setSavingLogId(logId);
    try {
      await onUpdateLogNote(logId, logNoteDraft.trim());
      setEditingLogId(null);
    } finally {
      setSavingLogId(null);
    }
  };

  const renderStatTile = (item: { key: keyof DelegateStatsPatch; label: string; accent?: string }) => {
    const val = statsDraft[item.key];
    return (
      <div
        key={item.key}
        className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col items-center justify-between gap-1.5"
      >
        <div className="flex items-center justify-between w-full gap-1">
          <button
            type="button"
            onClick={() => setStatValue(item.key, val - 1)}
            aria-label={`Decrease ${item.label}`}
            className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="number"
            min={0}
            max={10000}
            aria-label={item.label}
            value={val}
            onChange={(e) => setStatValue(item.key, Number(e.target.value))}
            className={`w-full min-w-0 text-center font-mono-tabular text-lg font-bold bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0047AB] rounded py-0.5 ${
              item.accent || 'text-slate-900'
            }`}
          />
          <button
            type="button"
            onClick={() => setStatValue(item.key, val + 1)}
            aria-label={`Increase ${item.label}`}
            className="w-6 h-6 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="text-[11px] leading-tight text-slate-600 text-center">{item.label}</div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CountryFlag code={delegate.countryCode} name={delegate.countryName} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-slate-900 truncate">
                  {delegate.countryName}
                </h2>
                <span className="text-xs font-mono-tabular font-bold text-[#0047AB] bg-blue-50 px-2 py-0.5 rounded shrink-0">
                  Total: {totalScore}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Delegation Dossier &amp; Editable Statistics
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close delegate details"
            className="p-2 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Session Attendance Quick Control */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-2">
              Current Session Attendance
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: 'absent', label: 'Absent', active: 'bg-red-600 text-white border-red-600' },
                  { key: 'present', label: 'Present', active: 'bg-sky-600 text-white border-sky-600' },
                  { key: 'pv', label: 'Present & Voting', active: 'bg-green-600 text-white border-green-600' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChangeAttendance(delegate.id, opt.key)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    attendanceStatus === opt.key
                      ? opt.active
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Core Debate Summary (Editable) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="block text-xs font-semibold text-slate-700">
                Debate &amp; Floor Statistics (Editable)
              </span>
              <div className="flex items-center gap-2">
                {statsSavedNotice && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                    <Check className="w-3.5 h-3.5" />
                    Stats saved
                  </span>
                )}
                <button
                  type="button"
                  disabled={savingStats || !statsDirty}
                  onClick={handleSaveStats}
                  className="px-3 py-1 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-40 rounded-md transition-colors cursor-pointer"
                >
                  {savingStats ? 'Saving...' : 'Save Stats'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CORE_STAT_FIELDS.map(renderStatTile)}
            </div>
          </div>

          {/* Resolutions & Amendments Stats (Editable) */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700">
              Resolutions &amp; Amendments
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RESOLUTION_STAT_FIELDS.map(renderStatTile)}
            </div>
          </div>

          {/* Private Chair Notes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="chair-notes"
                className="text-xs font-semibold text-slate-700"
              >
                Overall Chair Notes &amp; Awards Assessment (Private)
              </label>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                {notes.length}/{BLUEPRINT_BOUNDS.CHAIR_NOTES_MAX}
              </span>
            </div>
            <textarea
              id="chair-notes"
              rows={3}
              maxLength={BLUEPRINT_BOUNDS.CHAIR_NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record overall diplomacy quality, bloc leadership, or award consideration..."
              className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
            <div className="flex items-center justify-end gap-3">
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>

          {/* Separated Chronological Speech / POI / Motion / Amendment Log */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700">
                Separated Speech, POI &amp; Resolution Logs
              </h3>
              <span className="text-xs font-mono-tabular text-slate-500">
                {delegateLogs.length} {delegateLogs.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {delegateLogs.length === 0 ? (
              <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center text-xs text-slate-500">
                No speeches, POIs, motions, or amendments logged for {delegate.countryName} yet.
              </div>
            ) : (
              <div className="space-y-2">
                {delegateLogs.map((log) => {
                  const isEditing = editingLogId === log.id;
                  return (
                    <div
                      key={log.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-semibold text-slate-900 uppercase">
                              {log.type}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-[#0047AB] font-medium">{log.caucusMode}</span>
                            {log.outcome && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="text-[11px] font-medium text-slate-600 uppercase">
                                  {log.outcome.replace(/_/g, ' ')}
                                </span>
                              </>
                            )}
                            {log.durationSeconds > 0 && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono-tabular text-slate-500">
                                  {formatClock(log.durationSeconds)}
                                </span>
                              </>
                            )}
                          </div>
                          {log.topic && (
                            <p className="text-xs font-medium text-slate-800 break-words">
                              {log.topic}
                            </p>
                          )}
                          {(log.targetDelegateName || log.yieldType) && (
                            <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                              {log.targetDelegateName && (
                                <span>Target: {log.targetDelegateName}</span>
                              )}
                              {log.yieldType && <span>Yield: {log.yieldType}</span>}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLogId(isEditing ? null : log.id);
                              setLogNoteDraft(log.note || '');
                            }}
                            title="Edit note for this entry"
                            aria-label="Edit log note"
                            className="p-1.5 text-slate-400 hover:text-[#0047AB] rounded hover:bg-blue-50 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteLog(log)}
                            title="Undo / remove entry"
                            aria-label="Remove log entry"
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="flex items-center gap-1.5 pt-1">
                          <input
                            type="text"
                            maxLength={BLUEPRINT_BOUNDS.LOG_NOTE_MAX}
                            value={logNoteDraft}
                            onChange={(e) => setLogNoteDraft(e.target.value)}
                            placeholder="Add note for this entry..."
                            className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-[#0047AB] rounded-md text-slate-900 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={savingLogId === log.id}
                            onClick={() => handleSaveLogNote(log.id)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-md cursor-pointer"
                          >
                            {savingLogId === log.id ? '...' : 'Save'}
                          </button>
                        </div>
                      ) : log.note ? (
                        <div className="px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-700 break-words">
                          {log.note}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic">
                          No note recorded — click pencil to add one.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
