import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  KeyRound,
  MonitorPlay,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  addDelegateToCommittee,
  createMotion,
  createNewSession,
  createUnmodBloc,
  deleteActivityLogEntry,
  deleteMotion,
  deleteUnmodBloc,
  ensureCommitteeProjectorKey,
  logAmendmentOutcome,
  logDelegatePoi,
  logSpeechAndAdvance,
  resolveMotion,
  setupOrRotateCommitteeJoin,
  syncProjectorSnapshot,
  updateActiveSession,
  updateActivityLogNote,
  updateCaucusState,
  updateCommitteeMajorities,
  updateCommitteeTab,
  updateDelegateChairNotes,
  updateDelegateStats,
  updateSessionAttendance,
  updateSessionQuorumRatio,
} from '../lib/committeeService';
import {
  getGuestBundle,
  guestAddDelegate,
  guestCreateMotion,
  guestCreateNewSession,
  guestCreateUnmodBloc,
  guestDeleteActivityLogEntry,
  guestDeleteMotion,
  guestDeleteUnmodBloc,
  guestLogAmendmentOutcome,
  guestLogDelegatePoi,
  guestLogSpeechAndAdvance,
  guestResolveMotion,
  guestUpdateActiveSession,
  guestUpdateActivityLogNote,
  guestUpdateAttendance,
  guestUpdateCaucusState,
  guestUpdateCommitteeTab,
  guestUpdateDelegateChairNotes,
  guestUpdateDelegateStats,
  guestUpdateMajorities,
  guestUpdateQuorumRatio,
  subscribeGuestStore,
} from '../lib/guestStore';
import { computeQuorumMetrics } from '../lib/munRules';
import { exportCommitteeCsv, exportCommitteePdf } from '../lib/exports';
import type {
  ActivityLog,
  AttendanceStatus,
  CaucusState,
  Committee,
  CommitteeMember,
  Delegate,
  Motion,
  ProceduralTab,
  ProjectorSnapshot,
  Session,
  UnmodBloc,
} from '../types/mun';
import { DelegateSidebar } from './DelegateSidebar';
import { DelegateDetailsDrawer } from './DelegateDetailsDrawer';
import { RollCallTab } from './tabs/RollCallTab';
import { OpeningTab } from './tabs/OpeningTab';
import { MotionsTab } from './tabs/MotionsTab';
import { GslTab } from './tabs/GslTab';
import { ModTab } from './tabs/ModTab';
import { UnmodTab } from './tabs/UnmodTab';
import { CowTab } from './tabs/CowTab';
import { ResolutionsTab } from './tabs/ResolutionsTab';

interface CommitteeWorkspaceProps {
  user: User | null;
  isGuest: boolean;
  committeeId: string;
  onBackToDashboard: () => void;
}

const TABS: Array<{ key: ProceduralTab; label: string }> = [
  { key: 'roll_call', label: 'Roll Call' },
  { key: 'opening', label: 'Opening Speech' },
  { key: 'motions', label: 'Motions' },
  { key: 'gsl', label: 'GSL' },
  { key: 'mod', label: 'Mod' },
  { key: 'unmod', label: 'Unmod' },
  { key: 'cow', label: 'COW' },
  { key: 'resolutions', label: 'Resolutions' },
];

export function CommitteeWorkspace({
  user,
  isGuest,
  committeeId,
  onBackToDashboard,
}: CommitteeWorkspaceProps) {
  const [committee, setCommittee] = useState<Committee | null>(null);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [motions, setMotions] = useState<Motion[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [caucuses, setCaucuses] = useState<CaucusState[]>([]);
  const [blocs, setBlocs] = useState<UnmodBloc[]>([]);
  const [members, setMembers] = useState<CommitteeMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedDelegateId, setSelectedDelegateId] = useState<string | null>(null);
  const [projectorPopoverOpen, setProjectorPopoverOpen] = useState(false);
  const [projectorUrl, setProjectorUrl] = useState('');
  const [projectorCopied, setProjectorCopied] = useState(false);
  const [projectorPreparing, setProjectorPreparing] = useState(false);
  const [coChairPopoverOpen, setCoChairPopoverOpen] = useState(false);
  const [joinCodeCopied, setJoinCodeCopied] = useState(false);
  const [newJoinPassword, setNewJoinPassword] = useState('');
  const [showNewJoinPassword, setShowNewJoinPassword] = useState(false);
  const [regenerateOnSave, setRegenerateOnSave] = useState(false);
  const [savingJoinAccess, setSavingJoinAccess] = useState(false);
  const [joinAccessMsg, setJoinAccessMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const projectorPopoverRef = useRef<HTMLDivElement | null>(null);
  const coChairPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isGuest) {
      const syncFromGuest = () => {
        const bundle = getGuestBundle(committeeId);
        if (bundle) {
          setCommittee({ ...bundle.committee });
          setDelegates([...bundle.delegates]);
          setSessions([...bundle.sessions]);
          setMotions([...bundle.motions]);
          setLogs([...bundle.logs]);
          setCaucuses(Object.values(bundle.caucuses));
          setBlocs([...bundle.blocs]);
          setMembers([]);
        } else {
          setCommittee(null);
        }
        setLoading(false);
      };
      syncFromGuest();
      return subscribeGuestStore(syncFromGuest);
    }

    if (!user) return;
    setLoading(true);
    const comPath = `committees/${committeeId}`;
    const unsubCommittee = onSnapshot(
      doc(db, 'committees', committeeId),
      (snap) => {
        if (snap.exists()) {
          setCommittee({ id: snap.id, ...(snap.data() as Omit<Committee, 'id'>) });
        } else {
          setCommittee(null);
        }
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, comPath)
    );

    return () => {
      unsubCommittee();
    };
  }, [committeeId, isGuest, user]);

  const hasMemberArray = Boolean(
    user && committee?.memberIds && committee.memberIds.includes(user.uid)
  );

  useEffect(() => {
    if (isGuest || !user || !committee) return;

    const filterField = hasMemberArray ? 'memberIds' : 'ownerId';
    const filterOp = hasMemberArray ? 'array-contains' : '==';

    const makeSubListener = <T extends { id: string }>(
      subName: string,
      setter: (items: T[]) => void
    ) => {
      const path = `committees/${committeeId}/${subName}`;
      const q = query(
        collection(db, 'committees', committeeId, subName),
        where(filterField, filterOp, user.uid)
      );
      return onSnapshot(
        q,
        (snap) => {
          setter(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as T)
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, path)
      );
    };

    const unsubDelegates = makeSubListener<Delegate>('delegates', setDelegates);
    const unsubSessions = makeSubListener<Session>('sessions', setSessions);
    const unsubMotions = makeSubListener<Motion>('motions', setMotions);
    const unsubLogs = makeSubListener<ActivityLog>('logs', setLogs);
    const unsubCaucuses = makeSubListener<CaucusState>('caucuses', setCaucuses);
    const unsubBlocs = makeSubListener<UnmodBloc>('blocs', setBlocs);
    const unsubMembers = makeSubListener<CommitteeMember>('members', setMembers);

    return () => {
      unsubDelegates();
      unsubSessions();
      unsubMotions();
      unsubLogs();
      unsubCaucuses();
      unsubBlocs();
      unsubMembers();
    };
  }, [committeeId, isGuest, user, committee?.id, hasMemberArray]);

  const anyRunning = useMemo(() => caucuses.some((c) => c.timerRunning), [caucuses]);
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    const onOutsideClick = (e: MouseEvent) => {
      if (
        projectorPopoverRef.current &&
        !projectorPopoverRef.current.contains(e.target as Node)
      ) {
        setProjectorPopoverOpen(false);
      }
      if (
        coChairPopoverRef.current &&
        !coChairPopoverRef.current.contains(e.target as Node)
      ) {
        setCoChairPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.order - b.order),
    [sessions]
  );

  const activeSession = useMemo(
    () =>
      sortedSessions.find((s) => s.id === committee?.activeSessionId) || sortedSessions[0],
    [sortedSessions, committee?.activeSessionId]
  );

  const sortedLogs = useMemo(() => {
    const getMillis = (ts: unknown) => {
      if (typeof ts === 'number') return ts;
      if (ts && typeof ts === 'object' && 'toMillis' in ts) {
        return (ts as { toMillis: () => number }).toMillis();
      }
      return 0;
    };
    return [...logs].sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
  }, [logs]);

  const sortedBlocs = useMemo(() => {
    const getMillis = (ts: unknown) => {
      if (typeof ts === 'number') return ts;
      if (ts && typeof ts === 'object' && 'toMillis' in ts) {
        return (ts as { toMillis: () => number }).toMillis();
      }
      return 0;
    };
    return [...blocs].sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
  }, [blocs]);

  const caucusMap = useMemo(() => {
    const map: Record<
      'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions',
      CaucusState | undefined
    > = {
      opening: undefined,
      gsl: undefined,
      mod: undefined,
      unmod: undefined,
      cow: undefined,
      resolutions: undefined,
    };
    caucuses.forEach((c) => {
      map[c.mode] = c;
    });
    return map;
  }, [caucuses]);

  const liveTimers = useMemo(() => {
    const compute = (c: CaucusState | undefined) => {
      if (!c) return { total: 0, speaker: 0 };
      if (!c.timerRunning) {
        return {
          total: c.totalRemainingSeconds,
          speaker: c.speakerRemainingSeconds,
        };
      }
      const elapsed = Math.max(0, Math.floor((nowMs - c.timerUpdatedAtMs) / 1000));
      return {
        total: Math.max(0, c.totalRemainingSeconds - elapsed),
        speaker: Math.max(0, c.speakerRemainingSeconds - elapsed),
      };
    };
    return {
      opening: compute(caucusMap.opening),
      gsl: compute(caucusMap.gsl),
      mod: compute(caucusMap.mod),
      unmod: compute(caucusMap.unmod),
      cow: compute(caucusMap.cow),
      resolutions: compute(caucusMap.resolutions),
    };
  }, [caucusMap, nowMs]);

  const quorum = useMemo(
    () =>
      computeQuorumMetrics(
        delegates,
        activeSession,
        committee?.simpleMajorityFraction,
        committee?.supermajorityFraction
      ),
    [delegates, activeSession, committee?.simpleMajorityFraction, committee?.supermajorityFraction]
  );

  const selectedDelegate = useMemo(
    () => delegates.find((d) => d.id === selectedDelegateId) || null,
    [delegates, selectedDelegateId]
  );

  const cloudProjectorPayload = useMemo<Omit<ProjectorSnapshot, 'createdAt' | 'updatedAt'> | null>(() => {
    if (isGuest || !user || !committee) return null;
    const modeLabels: Record<ProceduralTab, string> = {
      roll_call: 'Roll Call & Quorum',
      opening: 'Opening Speeches',
      motions: 'Floor Motions',
      gsl: "General Speakers' List",
      mod: 'Moderated Caucus',
      unmod: 'Unmoderated Caucus',
      cow: 'Consultation of a Whole',
      resolutions: 'Resolutions',
    };
    const tab = committee.activeTab || 'roll_call';
    const modeKey: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions' =
      tab === 'opening' ||
      tab === 'mod' ||
      tab === 'unmod' ||
      tab === 'cow' ||
      tab === 'resolutions'
        ? tab
        : 'gsl';
    const activeCaucus = caucusMap[modeKey];
    const isResReading = modeKey === 'resolutions' && activeCaucus?.subMode === 'reading';
    const modeDisplayLabel =
      modeKey === 'resolutions'
        ? isResReading
          ? 'Resolutions · Reading/Amendment Writing'
          : 'Resolutions · Speech Mode'
        : modeLabels[tab];
    const delegateMap = new Map(delegates.map((d) => [d.id, d]));
    const currentSpeaker = activeCaucus?.currentSpeakerId
      ? delegateMap.get(activeCaucus.currentSpeakerId)
      : undefined;
    const upcomingQueue = (activeCaucus?.queue || [])
      .slice(0, 4)
      .map((id) => delegateMap.get(id))
      .filter((d): d is Delegate => Boolean(d))
      .map((d) => `${d.countryCode}|${d.countryName}`);

    return {
      ownerId: committee.ownerId,
      committeeId: committee.id,
      committeeName: committee.name,
      sessionName: activeSession?.name || 'Session 1',
      activeTab: tab,
      modeDisplayLabel,
      topic: activeCaucus?.topic || modeDisplayLabel,
      totalSeconds: activeCaucus?.totalSeconds || 0,
      speakerSeconds: activeCaucus?.speakerSeconds || 0,
      totalRemainingSeconds: activeCaucus?.totalRemainingSeconds || 0,
      speakerRemainingSeconds: activeCaucus?.speakerRemainingSeconds || 0,
      timerRunning: Boolean(activeCaucus?.timerRunning),
      timerUpdatedAtMs: activeCaucus?.timerUpdatedAtMs || Date.now(),
      isResReading,
      currentSpeakerName: currentSpeaker?.countryName || '',
      currentSpeakerCode: currentSpeaker?.countryCode || '',
      yieldType: activeCaucus?.yieldType || 'none',
      upcomingQueue,
      activeTotal: quorum.activeTotal,
      totalDelegations: quorum.totalDelegations,
      pvCount: quorum.pvCount,
      quorumNeeded: quorum.quorumNeeded,
      quorumMet: quorum.quorumMet,
      simpleMajority: quorum.simpleMajority,
      twoThirdsMajority: quorum.twoThirdsMajority,
      simpleFractionLabel: quorum.simpleFractionLabel,
      superFractionLabel: quorum.superFractionLabel,
    };
  }, [isGuest, user, committee, activeSession?.name, caucusMap, delegates, quorum]);

  useEffect(() => {
    if (isGuest || !user || !committee?.projectorKey || !cloudProjectorPayload) return;
    syncProjectorSnapshot(committee.projectorKey, cloudProjectorPayload).catch((err) => {
      console.error('Projector sync warning:', err);
    });
  }, [isGuest, user, committee?.projectorKey, cloudProjectorPayload]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Loading committee workspace...</div>
      </div>
    );
  }

  if (!committee) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 gap-4">
        <p className="text-sm text-slate-700">Committee not found or access denied.</p>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="px-4 py-2 text-sm font-semibold text-white bg-[#0047AB] rounded-lg cursor-pointer"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const activeTab = committee.activeTab || 'roll_call';
  const attendanceMap: Record<string, AttendanceStatus> = activeSession?.attendance || {};
  const ownerId = user?.uid || 'guest';
  const memberIds = committee.memberIds;
  const isCommitteeOwner = !isGuest && user?.uid === committee.ownerId;
  const coChairCount = members.length > 0 ? members.length : committee.memberIds?.length || 1;

  const handleTabChange = async (tab: ProceduralTab) => {
    if (isGuest) guestUpdateCommitteeTab(committee.id, tab);
    else await updateCommitteeTab(committee.id, tab);
  };

  return (
    <div className="h-[100dvh] lg:h-screen overflow-hidden bg-slate-50 flex flex-col">
      {/* Top Bar (3-Zone Contract) */}
      <header className="w-full bg-white border-b border-slate-200 shrink-0 z-30">
        <div className="px-4 sm:px-6 py-2.5 flex items-center justify-between gap-6">
          {/* Zone 1: Back + Brand/Committee Title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Committees
            </button>
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate">
              ChairOS | {committee.name}
            </h1>
          </div>

          {/* Zone 2: Unboxed Quorum Telemetry */}
          <div className="hidden lg:flex items-center gap-3 text-[13px] font-medium text-slate-600 tabular-nums whitespace-nowrap shrink-0">
            {isGuest && (
              <>
                <span className="text-[#0047AB] font-semibold">Guest Mode</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
              </>
            )}
            <span className="text-slate-700">{activeSession?.name || 'Session 1'}</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              Present:{' '}
              <strong className="font-semibold text-slate-900">
                {quorum.activeTotal}/{quorum.totalDelegations}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              Maj ({quorum.simpleFractionLabel} / {quorum.superFractionLabel}):{' '}
              <strong className="font-semibold text-[#0047AB]">{quorum.simpleMajority}</strong>
              <span className="text-slate-400 mx-1">/</span>
              <strong className="font-semibold text-slate-900">{quorum.twoThirdsMajority}</strong>
            </span>
          </div>

          {/* Zone 3: Primary Actions (Co-Chairs + Projector Link + Export) */}
          <div className="flex items-center gap-2 shrink-0 relative">
            <div className="relative" ref={coChairPopoverRef}>
              <button
                type="button"
                onClick={() => {
                  setJoinAccessMsg(null);
                  setCoChairPopoverOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-[#0047AB]" />
                {committee.joinCode ? (
                  <span className="font-mono-tabular tracking-wider font-bold text-slate-900">
                    {committee.joinCode}
                  </span>
                ) : (
                  <span className="hidden sm:inline">Co-Chairs</span>
                )}
                {coChairCount > 1 && (
                  <span className="text-[11px] font-mono-tabular text-[#0047AB] font-bold">
                    · {coChairCount}
                  </span>
                )}
              </button>

              {coChairPopoverOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-40 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-[#0047AB]" />
                      <span className="text-xs font-semibold text-slate-900">
                        Co-Chair Join Code &amp; Access
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCoChairPopoverOpen(false)}
                      aria-label="Close co-chair access menu"
                      className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {committee.joinCode ? (
                    <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">
                          4-Character Join Code
                        </div>
                        <div className="font-mono-tabular text-xl font-bold tracking-[0.22em] text-[#0047AB]">
                          {committee.joinCode}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!committee.joinCode) return;
                          if (navigator.clipboard?.writeText) {
                            try {
                              await navigator.clipboard.writeText(committee.joinCode);
                              setJoinCodeCopied(true);
                              window.setTimeout(() => setJoinCodeCopied(false), 1800);
                            } catch {
                              setJoinCodeCopied(false);
                            }
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer"
                      >
                        {joinCodeCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Code
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                      {isCommitteeOwner
                        ? 'Set a join password below to generate a 4-character co-chair code.'
                        : 'No join code has been configured for this committee yet.'}
                    </div>
                  )}

                  {isGuest ? (
                    <p className="text-xs text-slate-500">
                      Sign in with Google to collaborate live across multiple chairs using this 4-character code and password.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-slate-600">
                          Active Chairs ({coChairCount})
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                          {members.length === 0 ? (
                            <div className="text-xs text-slate-500 py-1">
                              {user?.displayName || 'Head Chair'} (Owner)
                            </div>
                          ) : (
                            members.map((m) => (
                              <div
                                key={m.uid}
                                className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-50"
                              >
                                <span className="font-medium text-slate-800 truncate">
                                  {m.displayName}
                                  {m.uid === user?.uid ? ' (You)' : ''}
                                </span>
                                <span className="text-[11px] text-slate-500 shrink-0 ml-2">
                                  {m.uid === committee.ownerId ? 'Owner' : 'Co-Chair'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {isCommitteeOwner && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (newJoinPassword.trim().length < 4) {
                              setJoinAccessMsg({
                                type: 'err',
                                text: 'Password must be at least 4 characters.',
                              });
                              return;
                            }
                            setSavingJoinAccess(true);
                            setJoinAccessMsg(null);
                            try {
                              const nextCode = await setupOrRotateCommitteeJoin({
                                committeeId: committee.id,
                                ownerId: committee.ownerId,
                                ownerDisplayName: user?.displayName || user?.email || 'Head Chair',
                                committeeName: committee.name,
                                password: newJoinPassword,
                                existingJoinCode: committee.joinCode,
                                regenerateCode: regenerateOnSave || !committee.joinCode,
                              });
                              setNewJoinPassword('');
                              setRegenerateOnSave(false);
                              setJoinAccessMsg({
                                type: 'ok',
                                text: `Updated access. Share code ${nextCode} & password with co-chairs.`,
                              });
                            } catch (err) {
                              setJoinAccessMsg({
                                type: 'err',
                                text:
                                  err instanceof Error
                                    ? err.message
                                    : 'Unable to update co-chair access.',
                              });
                            } finally {
                              setSavingJoinAccess(false);
                            }
                          }}
                          className="pt-2 border-t border-slate-100 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="workspace-join-pass"
                              className="text-[11px] font-semibold text-slate-700"
                            >
                              {committee.joinCode
                                ? 'Change Join Password'
                                : 'Set Join Password'}
                            </label>
                            {committee.joinCode && (
                              <button
                                type="button"
                                onClick={() => setRegenerateOnSave((v) => !v)}
                                className={`inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer ${
                                  regenerateOnSave ? 'text-[#0047AB]' : 'text-slate-500 hover:text-slate-800'
                                }`}
                              >
                                <RefreshCw className="w-3 h-3" />
                                {regenerateOnSave ? 'New code on save' : 'New code too?'}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <div className="relative flex-1">
                              <input
                                id="workspace-join-pass"
                                type={showNewJoinPassword ? 'text' : 'password'}
                                value={newJoinPassword}
                                onChange={(e) => setNewJoinPassword(e.target.value)}
                                placeholder="New password (min 4 chars)"
                                className="w-full pl-2.5 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewJoinPassword((s) => !s)}
                                aria-label={showNewJoinPassword ? 'Hide password' : 'Show password'}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                {showNewJoinPassword ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <button
                              type="submit"
                              disabled={savingJoinAccess}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-lg shrink-0 cursor-pointer"
                            >
                              {savingJoinAccess ? 'Saving...' : 'Save'}
                            </button>
                          </div>

                          {joinAccessMsg && (
                            <p
                              className={`text-[11px] font-medium ${
                                joinAccessMsg.type === 'ok' ? 'text-green-700' : 'text-red-600'
                              }`}
                            >
                              {joinAccessMsg.text}
                            </p>
                          )}
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="relative" ref={projectorPopoverRef}>
              <button
                type="button"
                disabled={projectorPreparing}
                onClick={async () => {
                  if (projectorPopoverOpen) {
                    setProjectorPopoverOpen(false);
                    return;
                  }
                  setProjectorPreparing(true);
                  try {
                    const base = `${window.location.origin}${window.location.pathname}`;
                    let targetUrl = '';
                    if (isGuest) {
                      targetUrl = `${base}?projector=1&mode=guest&committee=${encodeURIComponent(committee.id)}`;
                    } else {
                      const key =
                        committee.projectorKey || (await ensureCommitteeProjectorKey(committee.id));
                      if (cloudProjectorPayload) {
                        await syncProjectorSnapshot(key, cloudProjectorPayload);
                      }
                      targetUrl = `${base}?projector=1&mode=cloud&committee=${encodeURIComponent(committee.id)}&key=${encodeURIComponent(key)}`;
                    }
                    setProjectorUrl(targetUrl);
                    let copied = false;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      try {
                        await navigator.clipboard.writeText(targetUrl);
                        copied = true;
                      } catch {
                        copied = false;
                      }
                    }
                    setProjectorCopied(copied);
                    setProjectorPopoverOpen(true);
                  } finally {
                    setProjectorPreparing(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <MonitorPlay className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {projectorPreparing ? 'Syncing...' : 'Projector View'}
                </span>
              </button>

              {projectorPopoverOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-40 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {projectorCopied ? (
                        <>
                          <Check className="w-4 h-4 text-green-600" />
                          <span className="text-xs font-semibold text-green-700">
                            Synced Projector Link Copied
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-semibold text-slate-900">
                          Synced Projector Link
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setProjectorPopoverOpen(false)}
                      aria-label="Close projector link menu"
                      className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    Open this link in a separate browser tab or window to display a live-synced timer, speaker queue, and quorum board.
                  </p>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={projectorUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#0047AB]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          try {
                            await navigator.clipboard.writeText(projectorUrl);
                            setProjectorCopied(true);
                          } catch {
                            setProjectorCopied(false);
                          }
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg shrink-0 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {projectorCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  <div className="flex justify-end">
                    <a
                      href={projectorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0047AB] hover:underline"
                    >
                      Open Projector in New Tab
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>

              {exportMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40"
                  onMouseLeave={() => setExportMenuOpen(false)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      exportCommitteeCsv(committee, activeSession, delegates, sortedLogs);
                      setExportMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-green-700" />
                    Export Stats CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportCommitteePdf(
                        committee,
                        activeSession,
                        quorum,
                        delegates,
                        sortedLogs,
                        sortedBlocs
                      );
                      setExportMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-blue-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#0047AB]" />
                    Export PDF Dossier
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Body: Left Delegate Sidebar + Right Tabbed Workspace */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <DelegateSidebar
          delegates={delegates}
          attendance={attendanceMap}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onOpenDetails={(id) => setSelectedDelegateId(id)}
          onAddDelegate={async (countryName, countryCode) => {
            if (isGuest) {
              guestAddDelegate(committee.id, countryName, countryCode, activeSession?.id);
            } else {
              await addDelegateToCommittee({
                committeeId: committee.id,
                ownerId,
                memberIds,
                countryName,
                countryCode,
                activeSessionId: activeSession?.id,
                currentAttendance: attendanceMap,
                nextDelegateCount: delegates.length + 1,
              });
            }
          }}
        />

        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Procedural Folder Tabs */}
          <div className="bg-white border-b border-slate-200 px-4 sm:px-6 pt-3 flex items-center gap-1.5 overflow-x-auto shrink-0">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabChange(tab.key)}
                  className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-t-lg border border-b-0 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-slate-50 text-[#0047AB] border-slate-200 relative -mb-px pb-[9px]'
                      : 'bg-white text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Active Tab Stage (Viewport-Locked, Internal Module Scrolling) */}
          <div className="flex-1 min-h-0 p-4 sm:p-5 overflow-hidden flex flex-col">
            {activeTab === 'roll_call' && (
              <RollCallTab
                delegates={delegates}
                sessions={sortedSessions}
                activeSession={activeSession}
                quorum={quorum}
                simpleMajorityFraction={committee.simpleMajorityFraction || '1/2'}
                supermajorityFraction={committee.supermajorityFraction || '2/3'}
                onSelectSession={async (sessionId) => {
                  if (isGuest) guestUpdateActiveSession(committee.id, sessionId);
                  else await updateActiveSession(committee.id, sessionId);
                }}
                onCreateSession={async () => {
                  if (isGuest) {
                    guestCreateNewSession(
                      committee.id,
                      sortedSessions.length + 1,
                      delegates.map((d) => d.id)
                    );
                  } else {
                    await createNewSession(
                      committee.id,
                      ownerId,
                      sortedSessions.length + 1,
                      delegates.map((d) => d.id),
                      memberIds
                    );
                  }
                }}
                onUpdateAttendance={async (newMap) => {
                  if (!activeSession) return;
                  if (isGuest) guestUpdateAttendance(committee.id, activeSession.id, newMap);
                  else await updateSessionAttendance(committee.id, activeSession.id, newMap);
                }}
                onChangeQuorumRatio={async (ratio) => {
                  if (!activeSession) return;
                  if (isGuest) guestUpdateQuorumRatio(committee.id, activeSession.id, ratio);
                  else await updateSessionQuorumRatio(committee.id, activeSession.id, ratio);
                }}
                onUpdateMajorities={async (simpleFraction, superFraction) => {
                  if (isGuest) guestUpdateMajorities(committee.id, simpleFraction, superFraction);
                  else await updateCommitteeMajorities(committee.id, simpleFraction, superFraction);
                }}
              />
            )}

            {activeTab === 'opening' && (
              <OpeningTab
                caucus={caucusMap.opening}
                liveSpeakerSeconds={liveTimers.opening.speaker}
                delegates={delegates}
                attendance={attendanceMap}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'opening', patch);
                  else await updateCaucusState(committee.id, ownerId, 'opening', patch, memberIds);
                }}
                onCompleteSpeaker={async (params) => {
                  const defaultSpk = caucusMap.opening?.speakerSeconds || 60;
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'Opening' as const,
                    speakerId: params.speakerId,
                    speakerName: params.speakerName,
                    topic: caucusMap.opening?.topic || 'Opening Speeches',
                    durationSeconds: params.durationSeconds,
                    yieldType: 'none' as const,
                    note: params.note,
                    caucusPatch: {
                      currentSpeakerId: params.nextSpeakerId,
                      queue: params.nextQueue,
                      slotsUsed: params.nextSlotsUsed,
                      speakerRemainingSeconds: defaultSpk,
                      timerRunning: false,
                      timerUpdatedAtMs: Date.now(),
                    },
                  };
                  if (isGuest) guestLogSpeechAndAdvance(payload);
                  else await logSpeechAndAdvance({ ...payload, ownerId, memberIds });
                }}
              />
            )}

            {activeTab === 'motions' && (
              <MotionsTab
                delegates={delegates}
                attendance={attendanceMap}
                motions={motions}
                activeSessionId={activeSession?.id || ''}
                onCreateMotion={async (params) => {
                  if (isGuest) {
                    guestCreateMotion({
                      committeeId: committee.id,
                      sessionId: activeSession?.id || 'default',
                      ...params,
                    });
                  } else {
                    await createMotion({
                      committeeId: committee.id,
                      ownerId,
                      memberIds,
                      sessionId: activeSession?.id || 'default',
                      ...params,
                    });
                  }
                }}
                onResolveMotion={async (motion, outcome) => {
                  if (isGuest) {
                    guestResolveMotion({
                      committeeId: committee.id,
                      motion,
                      outcome,
                      launchCaucus: outcome === 'accepted',
                    });
                  } else {
                    await resolveMotion({
                      committeeId: committee.id,
                      ownerId,
                      memberIds,
                      motion,
                      outcome,
                      launchCaucus: outcome === 'accepted',
                    });
                  }
                }}
                onDeleteMotion={async (motionId) => {
                  if (isGuest) guestDeleteMotion(committee.id, motionId);
                  else await deleteMotion(committee.id, motionId);
                }}
              />
            )}

            {activeTab === 'gsl' && (
              <GslTab
                caucus={caucusMap.gsl}
                liveSpeakerSeconds={liveTimers.gsl.speaker}
                delegates={delegates}
                attendance={attendanceMap}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'gsl', patch);
                  else await updateCaucusState(committee.id, ownerId, 'gsl', patch, memberIds);
                }}
                onCompleteSpeaker={async (params) => {
                  const defaultSpk = caucusMap.gsl?.speakerSeconds || 90;
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'GSL' as const,
                    speakerId: params.speakerId,
                    speakerName: params.speakerName,
                    topic: caucusMap.gsl?.topic || "General Speakers' List",
                    durationSeconds: params.durationSeconds,
                    yieldType: params.yieldType,
                    yieldTargetName: params.yieldTargetName,
                    note: params.note,
                    caucusPatch: {
                      currentSpeakerId: params.nextSpeakerId,
                      queue: params.nextQueue,
                      speakerRemainingSeconds: defaultSpk,
                      timerRunning: false,
                      yieldType: 'none' as const,
                      yieldTargetId: '',
                      timerUpdatedAtMs: Date.now(),
                    },
                  };
                  if (isGuest) guestLogSpeechAndAdvance(payload);
                  else await logSpeechAndAdvance({ ...payload, ownerId, memberIds });
                }}
                onLogPoi={async (questioner, targetName, note) => {
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'GSL' as const,
                    questionerId: questioner.id,
                    questionerName: questioner.countryName,
                    targetDelegateName: targetName,
                    topic: caucusMap.gsl?.topic || "General Speakers' List",
                    note,
                  };
                  if (isGuest) guestLogDelegatePoi(payload);
                  else await logDelegatePoi({ ...payload, ownerId, memberIds });
                }}
              />
            )}

            {activeTab === 'mod' && (
              <ModTab
                caucus={caucusMap.mod}
                liveTotalSeconds={liveTimers.mod.total}
                liveSpeakerSeconds={liveTimers.mod.speaker}
                delegates={delegates}
                attendance={attendanceMap}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'mod', patch);
                  else await updateCaucusState(committee.id, ownerId, 'mod', patch, memberIds);
                }}
                onCompleteSpeaker={async (params) => {
                  const spkLimit = caucusMap.mod?.speakerSeconds || 60;
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'Mod' as const,
                    speakerId: params.speakerId,
                    speakerName: params.speakerName,
                    topic: params.topic,
                    durationSeconds: params.durationSeconds,
                    yieldType: 'none' as const,
                    note: params.note,
                    caucusPatch: {
                      currentSpeakerId: params.nextSpeakerId,
                      queue: params.nextQueue,
                      speakerRemainingSeconds: spkLimit,
                      totalRemainingSeconds: params.newTotalRemaining,
                      slotsUsed: params.newSlotsUsed,
                      timerRunning: false,
                      timerUpdatedAtMs: Date.now(),
                    },
                  };
                  if (isGuest) guestLogSpeechAndAdvance(payload);
                  else await logSpeechAndAdvance({ ...payload, ownerId, memberIds });
                }}
                onLogPoi={async (questioner, targetName, topic, note) => {
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'Mod' as const,
                    questionerId: questioner.id,
                    questionerName: questioner.countryName,
                    targetDelegateName: targetName,
                    topic,
                    note,
                  };
                  if (isGuest) guestLogDelegatePoi(payload);
                  else await logDelegatePoi({ ...payload, ownerId, memberIds });
                }}
              />
            )}

            {activeTab === 'unmod' && (
              <UnmodTab
                caucus={caucusMap.unmod}
                liveTotalSeconds={liveTimers.unmod.total}
                blocs={sortedBlocs}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'unmod', patch);
                  else await updateCaucusState(committee.id, ownerId, 'unmod', patch, memberIds);
                }}
                onCreateBloc={async (fields) => {
                  if (isGuest) {
                    guestCreateUnmodBloc({
                      committeeId: committee.id,
                      sessionId: activeSession?.id || 'default',
                      ...fields,
                    });
                  } else {
                    await createUnmodBloc({
                      committeeId: committee.id,
                      ownerId,
                      memberIds,
                      sessionId: activeSession?.id || 'default',
                      ...fields,
                    });
                  }
                }}
                onDeleteBloc={async (blocId) => {
                  if (isGuest) guestDeleteUnmodBloc(committee.id, blocId);
                  else await deleteUnmodBloc(committee.id, blocId);
                }}
              />
            )}

            {activeTab === 'cow' && (
              <CowTab
                caucus={caucusMap.cow}
                liveTotalSeconds={liveTimers.cow.total}
                delegates={delegates}
                attendance={attendanceMap}
                logs={sortedLogs}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'cow', patch);
                  else await updateCaucusState(committee.id, ownerId, 'cow', patch, memberIds);
                }}
                onPassFloor={async (params) => {
                  if (params.previousSpeakerId) {
                    const payload = {
                      committeeId: committee.id,
                      sessionId: activeSession?.id || 'default',
                      caucusMode: 'COW' as const,
                      speakerId: params.previousSpeakerId,
                      speakerName: params.previousSpeakerName,
                      topic: params.topic,
                      durationSeconds: params.durationSeconds,
                      yieldType: 'none' as const,
                      note: params.note,
                      caucusPatch: {
                        currentSpeakerId: params.nextSpeakerId,
                        totalRemainingSeconds: liveTimers.cow.total,
                        timerUpdatedAtMs: Date.now(),
                      },
                    };
                    if (isGuest) guestLogSpeechAndAdvance(payload);
                    else await logSpeechAndAdvance({ ...payload, ownerId, memberIds });
                  } else {
                    if (isGuest) {
                      guestUpdateCaucusState(committee.id, 'cow', {
                        currentSpeakerId: params.nextSpeakerId,
                      });
                    } else {
                      await updateCaucusState(
                        committee.id,
                        ownerId,
                        'cow',
                        {
                          currentSpeakerId: params.nextSpeakerId,
                        },
                        memberIds
                      );
                    }
                  }
                }}
              />
            )}

            {activeTab === 'resolutions' && (
              <ResolutionsTab
                caucus={caucusMap.resolutions}
                liveTotalSeconds={liveTimers.resolutions.total}
                liveSpeakerSeconds={liveTimers.resolutions.speaker}
                delegates={delegates}
                attendance={attendanceMap}
                logs={sortedLogs}
                onUpdateCaucus={async (patch) => {
                  if (isGuest) guestUpdateCaucusState(committee.id, 'resolutions', patch);
                  else await updateCaucusState(committee.id, ownerId, 'resolutions', patch, memberIds);
                }}
                onCompleteSpeech={async (params) => {
                  const defaultSpk = caucusMap.resolutions?.speakerSeconds || 90;
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'Resolutions' as const,
                    speakerId: params.speakerId,
                    speakerName: params.speakerName,
                    topic: params.topic,
                    durationSeconds: params.durationSeconds,
                    yieldType: params.yieldType,
                    yieldTargetName: params.yieldTargetName,
                    note: params.note,
                    speechCategory: params.speechCategory,
                    caucusPatch: {
                      currentSpeakerId: params.nextSpeakerId,
                      queue: params.nextQueue,
                      speakerRemainingSeconds: defaultSpk,
                      timerRunning: false,
                      yieldType: 'none' as const,
                      yieldTargetId: '',
                      timerUpdatedAtMs: Date.now(),
                    },
                  };
                  if (isGuest) guestLogSpeechAndAdvance(payload);
                  else await logSpeechAndAdvance({ ...payload, ownerId, memberIds });
                }}
                onLogPoi={async (questioner, targetName, topic, note) => {
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    caucusMode: 'Resolutions' as const,
                    questionerId: questioner.id,
                    questionerName: questioner.countryName,
                    targetDelegateName: targetName,
                    topic,
                    note,
                  };
                  if (isGuest) guestLogDelegatePoi(payload);
                  else await logDelegatePoi({ ...payload, ownerId, memberIds });
                }}
                onLogAmendment={async (params) => {
                  const payload = {
                    committeeId: committee.id,
                    sessionId: activeSession?.id || 'default',
                    ...params,
                  };
                  if (isGuest) guestLogAmendmentOutcome(payload);
                  else await logAmendmentOutcome({ ...payload, ownerId, memberIds });
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Delegate Details Slide-Over Drawer */}
      <DelegateDetailsDrawer
        delegate={selectedDelegate}
        attendanceStatus={
          selectedDelegate ? attendanceMap[selectedDelegate.id] || 'absent' : 'absent'
        }
        logs={sortedLogs}
        onClose={() => setSelectedDelegateId(null)}
        onSaveNotes={async (delId, notes) => {
          if (isGuest) guestUpdateDelegateChairNotes(committee.id, delId, notes);
          else await updateDelegateChairNotes(committee.id, delId, notes);
        }}
        onSaveStats={async (delId, stats) => {
          if (isGuest) guestUpdateDelegateStats(committee.id, delId, stats);
          else await updateDelegateStats(committee.id, delId, stats);
        }}
        onChangeAttendance={async (delId, status) => {
          if (!activeSession) return;
          const next = { ...attendanceMap, [delId]: status };
          if (isGuest) guestUpdateAttendance(committee.id, activeSession.id, next);
          else await updateSessionAttendance(committee.id, activeSession.id, next);
        }}
        onUpdateLogNote={async (logId, note) => {
          if (isGuest) guestUpdateActivityLogNote(committee.id, logId, note);
          else await updateActivityLogNote(committee.id, logId, note);
        }}
        onDeleteLog={async (log) => {
          if (isGuest) {
            guestDeleteActivityLogEntry(
              committee.id,
              log.id,
              log.delegateId,
              log.type,
              log.outcome
            );
          } else {
            await deleteActivityLogEntry(
              committee.id,
              log.id,
              log.delegateId,
              log.type,
              log.outcome
            );
          }
        }}
      />
    </div>
  );
}
