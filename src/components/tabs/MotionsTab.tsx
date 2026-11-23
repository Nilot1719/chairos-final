import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, Trash2, X } from 'lucide-react';
import type { AttendanceStatus, Delegate, Motion, MotionActionType } from '../../types/mun';
import {
  BLUEPRINT_BOUNDS,
  MOTION_LABELS,
  formatMotionDescription,
} from '../../lib/munRules';
import { CountryFlag } from '../CountryFlag';

interface MotionsTabProps {
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  motions: Motion[];
  activeSessionId: string;
  onCreateMotion: (params: {
    actionType: MotionActionType;
    proposerId: string;
    proposerName: string;
    proposerCode: string;
    totalSeconds: number;
    speakerSeconds: number;
    topic: string;
  }) => Promise<void>;
  onResolveMotion: (motion: Motion, outcome: 'accepted' | 'rejected') => Promise<void>;
  onDeleteMotion: (motionId: string) => Promise<void>;
}

const TIMED_ACTIONS: MotionActionType[] = ['unmod', 'cow', 'mod'];
const ACTION_ORDER: MotionActionType[] = ['unmod', 'cow', 'mod', 'gsl', 'other'];

export function MotionsTab({
  delegates,
  attendance,
  motions,
  activeSessionId,
  onCreateMotion,
  onResolveMotion,
  onDeleteMotion,
}: MotionsTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [actionType, setActionType] = useState<MotionActionType>('mod');
  const [proposerId, setProposerId] = useState('');
  const [proposerQuery, setProposerQuery] = useState('');
  const [proposerOpen, setProposerOpen] = useState(false);
  const [totalMinutes, setTotalMinutes] = useState(10);
  const [speakerSeconds, setSpeakerSeconds] = useState(60);
  const [topic, setTopic] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const proposerBoxRef = useRef<HTMLDivElement | null>(null);

  const eligibleProposers = useMemo(() => {
    const presentOnes = delegates.filter((d) => {
      const st = attendance[d.id];
      return st === 'present' || st === 'pv';
    });
    const source = presentOnes.length > 0 ? presentOnes : delegates;
    return [...source].sort((a, b) => a.countryName.localeCompare(b.countryName));
  }, [delegates, attendance]);

  const selectedProposer = useMemo(
    () => delegates.find((d) => d.id === proposerId) || null,
    [delegates, proposerId]
  );

  const filteredProposers = useMemo(() => {
    const q = proposerQuery.trim().toLowerCase();
    if (!q) return eligibleProposers;
    if (selectedProposer && selectedProposer.countryName.toLowerCase() === q) {
      return eligibleProposers;
    }
    return eligibleProposers.filter(
      (d) =>
        d.countryName.toLowerCase().includes(q) ||
        d.countryCode.toLowerCase().includes(q)
    );
  }, [eligibleProposers, proposerQuery, selectedProposer]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (proposerBoxRef.current && !proposerBoxRef.current.contains(e.target as Node)) {
        setProposerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const sessionMotions = useMemo(() => {
    return motions.filter((m) => m.sessionId === activeSessionId || !activeSessionId);
  }, [motions, activeSessionId]);

  const pendingMotions = useMemo(() => {
    return sessionMotions
      .filter((m) => m.status === 'pending')
      .sort((a, b) => b.disruptivenessScore - a.disruptivenessScore);
  }, [sessionMotions]);

  const resolvedMotions = useMemo(() => {
    return sessionMotions.filter((m) => m.status !== 'pending');
  }, [sessionMotions]);

  const needsTime = TIMED_ACTIONS.includes(actionType);
  const needsSpeakerTime = actionType === 'mod';

  const handleOpenForm = () => {
    if (!proposerId && eligibleProposers.length > 0) {
      setProposerId(eligibleProposers[0].id);
      setProposerQuery(eligibleProposers[0].countryName);
    }
    setShowForm(true);
    setFormError(null);
  };

  const handleSelectProposer = (del: Delegate) => {
    setProposerId(del.id);
    setProposerQuery(del.countryName);
    setProposerOpen(false);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = proposerQuery.trim().toLowerCase();
    const matchedByQuery = eligibleProposers.find(
      (d) => d.countryName.toLowerCase() === trimmedQuery
    );
    const proposer =
      matchedByQuery ||
      delegates.find((d) => d.id === proposerId) ||
      (filteredProposers.length === 1 ? filteredProposers[0] : null);

    if (!proposer) {
      setFormError('Select a proposing delegation from the list.');
      setProposerOpen(true);
      return;
    }

    if (actionType === 'other' && !topic.trim()) {
      setFormError('Please write a description for this motion.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onCreateMotion({
        actionType,
        proposerId: proposer.id,
        proposerName: proposer.countryName,
        proposerCode: proposer.countryCode,
        totalSeconds: needsTime ? Math.max(60, Math.min(7200, totalMinutes * 60)) : 0,
        speakerSeconds: needsSpeakerTime ? Math.max(15, Math.min(600, speakerSeconds)) : 0,
        topic: topic.trim(),
      });
      setTopic('');
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create motion.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (motion: Motion, outcome: 'accepted' | 'rejected') => {
    setResolvingId(motion.id);
    try {
      await onResolveMotion(motion, outcome);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      {/* Motions Header Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (showForm ? setShowForm(false) : handleOpenForm())}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'Close Form' : 'Create Motion'}
          </button>
          <span className="text-xs text-slate-500">
            {pendingMotions.length} pending on floor
          </span>
        </div>

        <span className="text-xs font-medium text-slate-600">
          Ranked from most to least disruptive (Unmod &gt; COW &gt; Mod &gt; GSL &gt; Other)
        </span>
      </div>

      {/* Create Motion Form Panel */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-blue-200 rounded-xl p-5 space-y-4 shrink-0 max-h-[42vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Propose New Floor Motion
            </h3>
            <span className="text-xs text-slate-500">
              COW always ranks above Moderated Caucus
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="motion-action"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Action
              </label>
              <select
                id="motion-action"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as MotionActionType)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
              >
                {ACTION_ORDER.map((key) => (
                  <option key={key} value={key}>
                    {MOTION_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div ref={proposerBoxRef} className="relative">
              <label
                htmlFor="motion-proposer"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Country Proposing
              </label>
              <div className="relative flex items-center">
                {selectedProposer &&
                selectedProposer.countryName.toLowerCase() === proposerQuery.trim().toLowerCase() ? (
                  <div className="pointer-events-none absolute left-2.5 flex items-center">
                    <CountryFlag
                      code={selectedProposer.countryCode}
                      name={selectedProposer.countryName}
                      size="sm"
                    />
                  </div>
                ) : (
                  <Search className="pointer-events-none absolute left-2.5 w-3.5 h-3.5 text-slate-400" />
                )}
                <input
                  id="motion-proposer"
                  type="text"
                  autoComplete="off"
                  value={proposerQuery}
                  onFocus={() => setProposerOpen(true)}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setProposerQuery(nextVal);
                    setProposerOpen(true);
                    const exact = eligibleProposers.find(
                      (d) => d.countryName.toLowerCase() === nextVal.trim().toLowerCase()
                    );
                    setProposerId(exact ? exact.id : '');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setProposerOpen(false);
                    } else if (e.key === 'Enter' && proposerOpen && filteredProposers.length > 0) {
                      e.preventDefault();
                      handleSelectProposer(filteredProposers[0]);
                    }
                  }}
                  placeholder="Type country name..."
                  className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Toggle delegate list"
                  onClick={() => setProposerOpen((prev) => !prev)}
                  className="absolute right-2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {proposerOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-30 divide-y divide-slate-100"
                >
                  {filteredProposers.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-slate-500">
                      No matching delegation found.
                    </div>
                  ) : (
                    filteredProposers.map((d) => {
                      const isSelected = d.id === proposerId;
                      const st = attendance[d.id];
                      return (
                        <button
                          key={d.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectProposer(d)}
                          className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 text-[#0047AB] font-semibold'
                              : 'text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <CountryFlag code={d.countryCode} name={d.countryName} size="sm" />
                            <span className="truncate">{d.countryName}</span>
                          </span>
                          <span className="text-[10px] font-semibold uppercase text-slate-400 shrink-0">
                            {st === 'pv' ? 'P&V' : st === 'present' ? 'Pres' : 'Abs'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {needsTime && (
              <div>
                <label
                  htmlFor="motion-total-time"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Total Time (minutes)
                </label>
                <input
                  id="motion-total-time"
                  type="number"
                  min={1}
                  max={120}
                  value={totalMinutes}
                  onChange={(e) => setTotalMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
                />
              </div>
            )}

            {needsSpeakerTime && (
              <div>
                <label
                  htmlFor="motion-speaker-time"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Speaking Time (seconds)
                </label>
                <input
                  id="motion-speaker-time"
                  type="number"
                  min={15}
                  max={600}
                  step={15}
                  value={speakerSeconds}
                  onChange={(e) => setSpeakerSeconds(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
                />
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="motion-topic"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {actionType === 'other'
                ? 'Motion Description (Required)'
                : 'Topic / Purpose (if applicable)'}
            </label>
            <input
              id="motion-topic"
              type="text"
              maxLength={BLUEPRINT_BOUNDS.TOPIC_MAX}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={
                actionType === 'other'
                  ? 'e.g., Suspend meeting for lunch, Introduce Draft Resolution 1.1, Move to voting procedure...'
                  : 'e.g., Climate finance mechanisms, Draft Resolution 1.1...'
              }
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
            />
          </div>

          {formError && (
            <p className="text-xs text-red-600">{formError}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'Creating...' : 'Create Motion'}
            </button>
          </div>
        </form>
      )}

      {/* Pending Motions List */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Active Floor Motions
          </h3>
          <span className="text-xs text-slate-500">
            Accepting a caucus motion launches its timer tab automatically
          </span>
        </div>

        {pendingMotions.length === 0 ? (
          <div className="p-8 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
            <p className="text-sm font-medium text-slate-800">No pending motions on the floor</p>
            <p className="text-xs text-slate-500">
              Click Create Motion to record proposals; ChairOS sorts them automatically from most to least disruptive.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {pendingMotions.map((motion, index) => (
              <div
                key={motion.id}
                className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono-tabular text-xs font-semibold text-slate-400 w-5 shrink-0">
                    {index + 1}.
                  </span>
                  <CountryFlag
                    code={motion.proposerCode}
                    name={motion.proposerName}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900">
                      <strong className="font-semibold">{motion.proposerName}</strong>{' '}
                      <span className="text-slate-500">for</span>{' '}
                      <span className="font-medium text-[#0047AB]">
                        {formatMotionDescription(motion)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={resolvingId === motion.id}
                    onClick={() => handleResolve(motion, 'accepted')}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={resolvingId === motion.id}
                    onClick={() => handleResolve(motion, 'rejected')}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteMotion(motion.id)}
                    aria-label="Delete motion"
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved Motions Ledger */}
      {resolvedMotions.length > 0 && (
        <div className="max-h-40 shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between shrink-0">
            <h3 className="font-display text-xs font-bold uppercase tracking-wider text-slate-500">
              Resolved Motions ({resolvedMotions.length})
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
            {resolvedMotions.map((motion) => (
              <div
                key={motion.id}
                className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CountryFlag
                    code={motion.proposerCode}
                    name={motion.proposerName}
                    size="sm"
                  />
                  <span className="font-semibold text-slate-800">{motion.proposerName}</span>
                  <span className="text-slate-500 truncate">
                    {formatMotionDescription(motion)}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`font-semibold uppercase ${
                      motion.status === 'accepted' ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    {motion.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteMotion(motion.id)}
                    aria-label="Delete resolved motion"
                    className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
