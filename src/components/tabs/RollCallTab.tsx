import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { AttendanceStatus, Delegate, QuorumMetrics, Session } from '../../types/mun';
import { BLUEPRINT_BOUNDS } from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';

interface RollCallTabProps {
  delegates: Delegate[];
  sessions: Session[];
  activeSession: Session | undefined;
  quorum: QuorumMetrics;
  simpleMajorityFraction: string;
  supermajorityFraction: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => Promise<void>;
  onUpdateAttendance: (newMap: Record<string, AttendanceStatus>) => Promise<void>;
  onChangeQuorumRatio: (ratio: 0.5 | 0.333) => Promise<void>;
  onUpdateMajorities: (simpleFraction: string, superFraction: string) => Promise<void>;
}

export function RollCallTab({
  delegates,
  sessions,
  activeSession,
  quorum,
  simpleMajorityFraction,
  supermajorityFraction,
  onSelectSession,
  onCreateSession,
  onUpdateAttendance,
  onChangeQuorumRatio,
  onUpdateMajorities,
}: RollCallTabProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);
  const [simpleDraft, setSimpleDraft] = useState(simpleMajorityFraction || '1/2');
  const [superDraft, setSuperDraft] = useState(supermajorityFraction || '2/3');
  const [savingMajorities, setSavingMajorities] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setSimpleDraft(simpleMajorityFraction || '1/2');
  }, [simpleMajorityFraction]);

  useEffect(() => {
    setSuperDraft(supermajorityFraction || '2/3');
  }, [supermajorityFraction]);

  const sortedDelegates = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return [...delegates]
      .filter((d) => q === '' || d.countryName.toLowerCase().includes(q))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));
  }, [delegates, filterQuery]);

  const handleSetSingle = async (delegateId: string, status: AttendanceStatus) => {
    if (!activeSession) return;
    const next = { ...(activeSession.attendance || {}), [delegateId]: status };
    await onUpdateAttendance(next);
  };

  const handleBulkStatus = async (status: AttendanceStatus) => {
    if (!activeSession) return;
    const next: Record<string, AttendanceStatus> = {};
    delegates.forEach((d) => {
      next[d.id] = status;
    });
    await onUpdateAttendance(next);
  };

  const handleAddSession = async () => {
    setCreatingSession(true);
    try {
      await onCreateSession();
    } finally {
      setCreatingSession(false);
    }
  };

  const handleSaveMajorities = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMajorities(true);
    try {
      await onUpdateMajorities(simpleDraft.trim() || '1/2', superDraft.trim() || '2/3');
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1800);
    } finally {
      setSavingMajorities(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Session & Quorum Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Select Committee Session"
              value={activeSession?.id || ''}
              onChange={(e) => onSelectSession(e.target.value)}
              className="px-3 py-2 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[#0047AB] cursor-pointer"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={creatingSession}
              onClick={handleAddSession}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {creatingSession ? 'Adding...' : 'New Session'}
            </button>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              <span className="px-2 text-slate-500 font-medium">Quorum:</span>
              <button
                type="button"
                onClick={() => onChangeQuorumRatio(0.5)}
                className={`px-2 py-1 rounded font-mono-tabular font-semibold transition-colors cursor-pointer ${
                  (activeSession?.quorumRatio ?? 0.5) === 0.5
                    ? 'bg-white text-[#0047AB]'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1/2
              </button>
              <button
                type="button"
                onClick={() => onChangeQuorumRatio(0.333)}
                className={`px-2 py-1 rounded font-mono-tabular font-semibold transition-colors cursor-pointer ${
                  activeSession?.quorumRatio === 0.333
                    ? 'bg-white text-[#0047AB]'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1/3
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleBulkStatus('present')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Mark All Present
            </button>
            <button
              type="button"
              onClick={() => handleBulkStatus('absent')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Reset Roll Call
            </button>
          </div>
        </div>

        {/* Custom Majority Fraction Controls */}
        <form
          onSubmit={handleSaveMajorities}
          className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100"
        >
          <span className="text-xs font-semibold text-slate-700">
            Majority Thresholds:
          </span>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span>Simple</span>
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.FRACTION_MAX}
              value={simpleDraft}
              onChange={(e) => setSimpleDraft(e.target.value)}
              placeholder="1/2"
              className="w-20 px-2.5 py-1 text-xs font-mono-tabular font-semibold bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span>Supermajority</span>
            <input
              type="text"
              maxLength={BLUEPRINT_BOUNDS.FRACTION_MAX}
              value={superDraft}
              onChange={(e) => setSuperDraft(e.target.value)}
              placeholder="2/3"
              className="w-20 px-2.5 py-1 text-xs font-mono-tabular font-semibold bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
          </label>
          <button
            type="submit"
            disabled={savingMajorities}
            className="px-3 py-1 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-md transition-colors cursor-pointer"
          >
            {savingMajorities ? 'Saving...' : 'Update Fractions'}
          </button>
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
              <Check className="w-3.5 h-3.5" />
              Updated
            </span>
          )}
        </form>

        {/* Quorum & Majority Math Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <div className="text-[11px] text-slate-500">Quorum Status</div>
            <div
              className={`font-mono-tabular text-sm font-bold mt-0.5 ${
                quorum.quorumMet ? 'text-green-700' : 'text-amber-700'
              }`}
            >
              {quorum.quorumMet ? 'MET' : 'NOT MET'} ({quorum.activeTotal}/{quorum.quorumNeeded})
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <div className="text-[11px] text-slate-500">Present / P&amp;V</div>
            <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
              {quorum.presentCount} P · {quorum.pvCount} P&amp;V
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <div className="text-[11px] text-slate-500">Absent</div>
            <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
              {quorum.absentCount} / {quorum.totalDelegations}
            </div>
          </div>
          <div className="p-2.5 bg-blue-50/70 rounded-lg">
            <div className="text-[11px] text-[#0047AB] font-medium">
              Simple Majority ({quorum.simpleFractionLabel})
            </div>
            <div className="font-mono-tabular text-sm font-bold text-[#0047AB] mt-0.5">
              {quorum.simpleMajority} votes
            </div>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <div className="text-[11px] text-slate-500">
              Supermajority ({quorum.superFractionLabel})
            </div>
            <div className="font-mono-tabular text-sm font-bold text-slate-900 mt-0.5">
              {quorum.twoThirdsMajority} votes
            </div>
          </div>
        </div>
      </div>

      {/* Roll Call Table (Self-contained scroll module) */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Delegation Attendance ({activeSession?.name || 'Session 1'})
          </h3>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter roll call..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
          {sortedDelegates.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No delegations found.
            </div>
          ) : (
            sortedDelegates.map((delegate) => {
              const status: AttendanceStatus =
                activeSession?.attendance?.[delegate.id] || 'absent';

              return (
                <div
                  key={delegate.id}
                  className="px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CountryFlag
                      code={delegate.countryCode}
                      name={delegate.countryName}
                      size="md"
                    />
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {delegate.countryName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSetSingle(delegate.id, 'absent')}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        status === 'absent'
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Absent
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetSingle(delegate.id, 'present')}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        status === 'present'
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Present
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetSingle(delegate.id, 'pv')}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        status === 'pv'
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      P&amp;V
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
