import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getGuestBundle, subscribeGuestStore } from '../lib/guestStore';
import { computeQuorumMetrics, dedupeSpeakerQueue, formatClock } from '../lib/munRules';
import type {
  CaucusState,
  Delegate,
  ProceduralTab,
  ProjectorSnapshot,
} from '../types/mun';
import { CountryFlag } from './CountryFlag';

const MODE_LABELS: Record<ProceduralTab, string> = {
  roll_call: 'Roll Call & Quorum',
  opening: 'Opening Speeches',
  motions: 'Floor Motions',
  gsl: "General Speakers' List",
  mod: 'Moderated Caucus',
  unmod: 'Unmoderated Caucus',
  cow: 'Consultation of a Whole',
  resolutions: 'Resolutions',
};

function buildSnapshotFromGuest(committeeId: string): ProjectorSnapshot | null {
  const bundle = getGuestBundle(committeeId);
  if (!bundle) return null;
  const { committee, delegates, sessions, caucuses } = bundle;
  const sortedSessions = [...sessions].sort((a, b) => a.order - b.order);
  const activeSession =
    sortedSessions.find((s) => s.id === committee.activeSessionId) || sortedSessions[0];
  const quorum = computeQuorumMetrics(
    delegates,
    activeSession,
    committee.simpleMajorityFraction,
    committee.supermajorityFraction
  );

  const activeTab = committee.activeTab || 'roll_call';
  const modeKey: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions' =
    activeTab === 'opening' ||
    activeTab === 'mod' ||
    activeTab === 'unmod' ||
    activeTab === 'cow' ||
    activeTab === 'resolutions'
      ? activeTab
      : 'gsl';
  const activeCaucus: CaucusState | undefined = caucuses[modeKey];
  const isResReading = modeKey === 'resolutions' && activeCaucus?.subMode === 'reading';

  const modeDisplayLabel =
    modeKey === 'resolutions'
      ? isResReading
        ? 'Resolutions · Reading/Amendment Writing'
        : 'Resolutions · Speech Mode'
      : MODE_LABELS[activeTab];

  const delegateMap = new Map(delegates.map((d) => [d.id, d]));
  const currentSpeaker = activeCaucus?.currentSpeakerId
    ? delegateMap.get(activeCaucus.currentSpeakerId)
    : undefined;

  const upcomingQueue = dedupeSpeakerQueue(
    activeCaucus?.queue || [],
    activeCaucus?.currentSpeakerId
  )
    .slice(0, 4)
    .map((id) => delegateMap.get(id))
    .filter((d): d is Delegate => Boolean(d))
    .map((d) => `${d.countryCode}|${d.countryName}`);

  return {
    ownerId: 'guest',
    committeeId: committee.id,
    committeeName: committee.name,
    sessionName: activeSession?.name || 'Session 1',
    activeTab,
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
}

export function ProjectorScreen() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = params.get('mode') === 'guest' ? 'guest' : 'cloud';
  const committeeId = params.get('committee') || '';
  const projectorKey = params.get('key') || '';

  const [snapshot, setSnapshot] = useState<ProjectorSnapshot | null>(() =>
    mode === 'guest' && committeeId ? buildSnapshotFromGuest(committeeId) : null
  );
  const [loading, setLoading] = useState(() => mode === 'cloud');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (mode === 'guest') {
      if (!committeeId) {
        setErrorMsg('Missing committee identifier in projector link.');
        setLoading(false);
        return;
      }
      const sync = () => {
        const next = buildSnapshotFromGuest(committeeId);
        setSnapshot(next);
        setErrorMsg(next ? null : 'Guest session not found on this browser.');
        setLoading(false);
      };
      sync();
      return subscribeGuestStore(sync);
    }

    if (!projectorKey) {
      setErrorMsg('Missing projector sync key in link.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'projectors', projectorKey),
      (snap) => {
        if (snap.exists()) {
          setSnapshot(snap.data() as ProjectorSnapshot);
          setErrorMsg(null);
        } else {
          setSnapshot(null);
          setErrorMsg('Waiting for the chair dashboard to start broadcasting...');
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setErrorMsg(err.message || 'Unable to connect to live projector stream.');
      }
    );
    return () => unsub();
  }, [committeeId, mode, projectorKey]);

  const isRunning = Boolean(snapshot?.timerRunning);
  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [isRunning, snapshot?.timerUpdatedAtMs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="text-sm font-medium text-slate-600">
          Connecting to live ChairOS stage...
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="text-sm font-semibold text-[#0047AB]">ChairOS Projector Display</div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Projector Feed Unavailable
        </h1>
        <p className="text-sm text-slate-600 max-w-md">
          {errorMsg || 'Open the committee workspace and copy a fresh synced projector link.'}
        </p>
      </div>
    );
  }

  const elapsed = snapshot.timerRunning
    ? Math.max(0, Math.floor((nowMs - snapshot.timerUpdatedAtMs) / 1000))
    : 0;
  const liveTotalSeconds = Math.max(0, snapshot.totalRemainingSeconds - elapsed);
  const liveSpeakerSeconds = Math.max(0, snapshot.speakerRemainingSeconds - elapsed);

  const modeKey: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions' =
    snapshot.activeTab === 'opening' ||
    snapshot.activeTab === 'mod' ||
    snapshot.activeTab === 'unmod' ||
    snapshot.activeTab === 'cow' ||
    snapshot.activeTab === 'resolutions'
      ? snapshot.activeTab
      : 'gsl';

  const mainClockSeconds =
    modeKey === 'unmod' || modeKey === 'cow' || snapshot.isResReading
      ? liveTotalSeconds
      : liveSpeakerSeconds;
  const mainClockWarning = mainClockSeconds > 0 && mainClockSeconds <= 15;
  const mainClockExpired =
    mainClockSeconds === 0 && (snapshot.totalSeconds > 0 || snapshot.speakerSeconds > 0);

  const upcomingSpeakers = (snapshot.upcomingQueue || []).map((item) => {
    const idx = item.indexOf('|');
    if (idx === -1) return { code: 'UN', name: item };
    return { code: item.slice(0, idx) || 'UN', name: item.slice(idx + 1) };
  });

  return (
    <div className="min-h-screen bg-white flex flex-col justify-between p-8 sm:p-12">
      {/* Projector Top Header */}
      <div className="flex items-center justify-between gap-6 border-b border-slate-200 pb-6">
        <div>
          <div className="text-sm font-semibold text-[#0047AB]">
            ChairOS · {snapshot.sessionName}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mt-1">
            {snapshot.committeeName}
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right font-mono-tabular">
            <div className="text-xs text-slate-500">Present / Total</div>
            <div className="text-xl font-bold text-slate-900">
              {snapshot.activeTotal} / {snapshot.totalDelegations}
            </div>
          </div>
          <div className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
            Live Synced
          </div>
        </div>
      </div>

      {/* Projector Main Stage */}
      <div className="flex-1 flex flex-col items-center justify-center py-8 text-center max-w-5xl mx-auto w-full">
        <div className="text-sm font-semibold text-[#0047AB] uppercase tracking-wider mb-2">
          {snapshot.modeDisplayLabel}
        </div>

        <h2 className="font-display text-2xl sm:text-4xl font-bold text-slate-900 mb-8 [text-wrap:balance]">
          {snapshot.topic || snapshot.modeDisplayLabel}
        </h2>

        {snapshot.activeTab === 'roll_call' || snapshot.activeTab === 'motions' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-3xl">
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="font-mono-tabular text-4xl font-bold text-slate-900">
                {snapshot.activeTotal}
              </div>
              <div className="text-sm text-slate-600 mt-1">Present Delegations</div>
            </div>
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="font-mono-tabular text-4xl font-bold text-green-700">
                {snapshot.pvCount}
              </div>
              <div className="text-sm text-slate-600 mt-1">Present &amp; Voting</div>
            </div>
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="font-mono-tabular text-4xl font-bold text-[#0047AB]">
                {snapshot.simpleMajority}
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Simple Majority ({snapshot.simpleFractionLabel})
              </div>
            </div>
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="font-mono-tabular text-4xl font-bold text-slate-900">
                {snapshot.twoThirdsMajority}
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Supermajority ({snapshot.superFractionLabel})
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-8">
            <div
              className={`font-mono-tabular text-7xl sm:text-9xl font-bold tracking-tight ${
                mainClockExpired
                  ? 'text-red-600'
                  : mainClockWarning
                    ? 'text-amber-600'
                    : 'text-[#0047AB]'
              }`}
            >
              {formatClock(mainClockSeconds)}
            </div>

            {modeKey === 'mod' && (
              <div className="text-lg font-mono-tabular text-slate-600">
                Caucus Remaining:{' '}
                <strong className="text-slate-900">{formatClock(liveTotalSeconds)}</strong>
                <span className="mx-3 text-slate-300">|</span>
                Speaker Limit:{' '}
                <strong className="text-slate-900">{formatClock(snapshot.speakerSeconds || 60)}</strong>
              </div>
            )}

            {modeKey !== 'unmod' && !snapshot.isResReading && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left pt-4">
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    {modeKey === 'cow' ? 'Holding the Floor' : 'Current Speaker'}
                  </div>
                  {snapshot.currentSpeakerName ? (
                    <div className="flex items-center gap-4">
                      <CountryFlag
                        code={snapshot.currentSpeakerCode || 'UN'}
                        name={snapshot.currentSpeakerName}
                        size="lg"
                      />
                      <div>
                        <div className="font-display text-2xl font-bold text-slate-900">
                          {snapshot.currentSpeakerName}
                        </div>
                        {snapshot.yieldType && snapshot.yieldType !== 'none' && (
                          <div className="text-sm text-[#0047AB] font-medium mt-0.5">
                            Yield: {snapshot.yieldType.toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-lg text-slate-400">
                      Chair recognizing next delegation...
                    </div>
                  )}
                </div>

                <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    {modeKey === 'cow' ? 'Consultation of a Whole' : 'Up Next on List'}
                  </div>
                  {modeKey === 'cow' ? (
                    <p className="text-base text-slate-700">
                      Direct floor-passing active (no POIs). Raise placards to receive the floor from the current speaker.
                    </p>
                  ) : upcomingSpeakers.length === 0 ? (
                    <div className="text-base text-slate-400">Queue empty</div>
                  ) : (
                    <div className="space-y-2">
                      {upcomingSpeakers.map((sp, idx) => (
                        <div key={`${sp.name}_${idx}`} className="flex items-center gap-3">
                          <span className="font-mono-tabular text-sm text-slate-400 w-5">
                            {idx + 1}.
                          </span>
                          <CountryFlag code={sp.code} name={sp.name} size="sm" />
                          <span className="text-base font-semibold text-slate-800">
                            {sp.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Projector Footer Quorum Strip */}
      <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-600 font-mono-tabular">
        <span>
          Quorum:{' '}
          <strong className={snapshot.quorumMet ? 'text-green-700' : 'text-amber-700'}>
            {snapshot.quorumMet ? 'MET' : 'NOT MET'}
          </strong>{' '}
          ({snapshot.activeTotal}/{snapshot.quorumNeeded} min)
        </span>
        <span>
          Simple ({snapshot.simpleFractionLabel}):{' '}
          <strong className="text-slate-900">{snapshot.simpleMajority}</strong>
          <span className="mx-3 text-slate-300">·</span>
          Super ({snapshot.superFractionLabel}):{' '}
          <strong className="text-slate-900">{snapshot.twoThirdsMajority}</strong>
          <span className="mx-3 text-slate-300">·</span>
          P&amp;V: <strong className="text-slate-900">{snapshot.pvCount}</strong>
        </span>
      </div>
    </div>
  );
}
