import {
  BLUEPRINT_BOUNDS,
  clampStr,
  computeDisruptivenessScore,
  makeJoinCode,
  makeSafeId,
  normalizeJoinCode,
} from './munRules';
import type {
  ActivityLog,
  AttendanceStatus,
  CaucusState,
  Committee,
  Delegate,
  DelegateStatsPatch,
  Motion,
  MotionActionType,
  ProceduralTab,
  ResolutionSpeechCategory,
  Session,
  UnmodBloc,
  YieldType,
} from '../types/mun';

const STORAGE_KEY = 'chairOS_guest_v1';
const SYNC_CHANNEL_NAME = 'chairOS_guest_sync';

interface GuestCommitteeBundle {
  committee: Committee;
  delegates: Delegate[];
  sessions: Session[];
  motions: Motion[];
  logs: ActivityLog[];
  caucuses: Record<'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions', CaucusState>;
  blocs: UnmodBloc[];
}

interface GuestDatabase {
  bundles: Record<string, GuestCommitteeBundle>;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function broadcastSync() {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.postMessage({ type: 'sync', at: Date.now() });
      ch.close();
    } catch {
      // ignore broadcast errors
    }
  }
}

function defaultOpeningCaucus(now: number): CaucusState {
  return {
    id: 'opening',
    ownerId: 'guest',
    mode: 'opening',
    topic: 'Opening Speeches',
    totalSeconds: 0,
    speakerSeconds: 60,
    totalRemainingSeconds: 0,
    speakerRemainingSeconds: 60,
    timerRunning: false,
    timerUpdatedAtMs: now,
    currentSpeakerId: '',
    yieldType: 'none',
    yieldTargetId: '',
    queue: [],
    slotsUsed: 0,
    updatedAt: now,
  };
}

function defaultResolutionsCaucus(now: number): CaucusState {
  return {
    id: 'resolutions',
    ownerId: 'guest',
    mode: 'resolutions',
    topic: 'Main Submitter Speech',
    totalSeconds: 180,
    speakerSeconds: 90,
    totalRemainingSeconds: 180,
    speakerRemainingSeconds: 90,
    timerRunning: false,
    timerUpdatedAtMs: now,
    currentSpeakerId: '',
    yieldType: 'none',
    yieldTargetId: '',
    queue: [],
    slotsUsed: 0,
    subMode: 'speech',
    speechCategory: 'main_sub',
    updatedAt: now,
  };
}

function createSeedDatabase(): GuestDatabase {
  const comId = 'guest_com_ylscmun';
  const sesId = 'guest_ses_1';
  const now = Date.now();

  const starterCountries = [
    { id: 'del_de', name: 'Germany', code: 'DE', status: 'pv' as AttendanceStatus, sp: 1, poi: 2, mp: 1, ma: 0 },
    { id: 'del_th', name: 'Thailand', code: 'TH', status: 'pv' as AttendanceStatus, sp: 2, poi: 3, mp: 1, ma: 1 },
    { id: 'del_fr', name: 'France', code: 'FR', status: 'present' as AttendanceStatus, sp: 1, poi: 1, mp: 0, ma: 0 },
    { id: 'del_jp', name: 'Japan', code: 'JP', status: 'pv' as AttendanceStatus, sp: 1, poi: 2, mp: 0, ma: 0 },
    { id: 'del_br', name: 'Brazil', code: 'BR', status: 'present' as AttendanceStatus, sp: 0, poi: 1, mp: 0, ma: 0 },
    { id: 'del_in', name: 'India', code: 'IN', status: 'pv' as AttendanceStatus, sp: 1, poi: 0, mp: 0, ma: 0 },
    { id: 'del_sg', name: 'Singapore', code: 'SG', status: 'present' as AttendanceStatus, sp: 0, poi: 1, mp: 0, ma: 0 },
    { id: 'del_id', name: 'Indonesia', code: 'ID', status: 'pv' as AttendanceStatus, sp: 0, poi: 0, mp: 0, ma: 0 },
    { id: 'del_gb', name: 'United Kingdom', code: 'GB', status: 'absent' as AttendanceStatus, sp: 0, poi: 0, mp: 0, ma: 0 },
    { id: 'del_us', name: 'United States', code: 'US', status: 'absent' as AttendanceStatus, sp: 0, poi: 0, mp: 0, ma: 0 },
    { id: 'del_kr', name: 'Republic of Korea', code: 'KR', status: 'absent' as AttendanceStatus, sp: 0, poi: 0, mp: 0, ma: 0 },
    { id: 'del_za', name: 'South Africa', code: 'ZA', status: 'absent' as AttendanceStatus, sp: 0, poi: 0, mp: 0, ma: 0 },
  ];

  const attendance: Record<string, AttendanceStatus> = {};
  const delegates: Delegate[] = starterCountries.map((c) => {
    attendance[c.id] = c.status;
    return {
      id: c.id,
      ownerId: 'guest',
      countryName: c.name,
      countryCode: c.code,
      speechesCount: c.sp,
      poisCount: c.poi,
      motionsProposedCount: c.mp,
      motionsAcceptedCount: c.ma,
      mainSubSpeechesCount: c.id === 'del_th' ? 1 : 0,
      amendmentsProposedCount: c.id === 'del_de' ? 1 : 0,
      amendmentsPassedCount: c.id === 'del_de' ? 1 : 0,
      amendmentSpeechesCount: 0,
      chairNotes:
        c.id === 'del_th'
          ? 'Strong floor presence and active POI follow-ups.'
          : '',
      createdAt: now,
      updatedAt: now,
    };
  });

  const committee: Committee = {
    id: comId,
    ownerId: 'guest',
    name: 'YLSCMUN IV UNHRC',
    activeSessionId: sesId,
    activeTab: 'roll_call',
    delegateCount: delegates.length,
    sessionCount: 1,
    simpleMajorityFraction: '1/2',
    supermajorityFraction: '2/3',
    joinCode: 'YL26',
    memberIds: ['guest'],
    createdAt: now,
    updatedAt: now,
  };

  const session: Session = {
    id: sesId,
    ownerId: 'guest',
    name: 'Session 1',
    order: 1,
    quorumRatio: 0.5,
    attendance,
    createdAt: now,
    updatedAt: now,
  };

  const motions: Motion[] = [
    {
      id: 'guest_mot_1',
      ownerId: 'guest',
      sessionId: sesId,
      actionType: 'unmod',
      proposerId: 'del_th',
      proposerName: 'Thailand',
      proposerCode: 'TH',
      totalSeconds: 720,
      speakerSeconds: 0,
      topic: 'Working Paper Formation',
      disruptivenessScore: computeDisruptivenessScore('unmod', 720, 0),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'guest_mot_2',
      ownerId: 'guest',
      sessionId: sesId,
      actionType: 'mod',
      proposerId: 'del_de',
      proposerName: 'Germany',
      proposerCode: 'DE',
      totalSeconds: 600,
      speakerSeconds: 60,
      topic: 'Climate Change & Human Rights',
      disruptivenessScore: computeDisruptivenessScore('mod', 600, 60),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const logs: ActivityLog[] = [
    {
      id: 'guest_log_1',
      ownerId: 'guest',
      sessionId: sesId,
      delegateId: 'del_th',
      delegateName: 'Thailand',
      type: 'speech',
      caucusMode: 'GSL',
      topic: "General Speakers' List",
      durationSeconds: 78,
      targetDelegateName: '',
      yieldType: 'pois',
      outcome: 'completed',
      note: 'Emphasized ASEAN regional climate resilience framework.',
      createdAt: now - 120000,
    },
    {
      id: 'guest_log_2',
      ownerId: 'guest',
      sessionId: sesId,
      delegateId: 'del_de',
      delegateName: 'Germany',
      type: 'poi',
      caucusMode: 'GSL',
      topic: "General Speakers' List",
      durationSeconds: 0,
      targetDelegateName: 'Thailand',
      yieldType: '',
      outcome: 'asked',
      note: 'Asked about funding accountability mechanism.',
      createdAt: now - 90000,
    },
  ];

  const caucuses: Record<'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions', CaucusState> = {
    opening: defaultOpeningCaucus(now),
    gsl: {
      id: 'gsl',
      ownerId: 'guest',
      mode: 'gsl',
      topic: "General Speakers' List",
      totalSeconds: 0,
      speakerSeconds: 90,
      totalRemainingSeconds: 0,
      speakerRemainingSeconds: 90,
      timerRunning: false,
      timerUpdatedAtMs: now,
      currentSpeakerId: 'del_de',
      yieldType: 'none',
      yieldTargetId: '',
      queue: ['del_fr', 'del_jp'],
      slotsUsed: 0,
      updatedAt: now,
    },
    mod: {
      id: 'mod',
      ownerId: 'guest',
      mode: 'mod',
      topic: 'Climate Change & Human Rights',
      totalSeconds: 600,
      speakerSeconds: 60,
      totalRemainingSeconds: 600,
      speakerRemainingSeconds: 60,
      timerRunning: false,
      timerUpdatedAtMs: now,
      currentSpeakerId: '',
      yieldType: 'none',
      yieldTargetId: '',
      queue: [],
      slotsUsed: 0,
      updatedAt: now,
    },
    unmod: {
      id: 'unmod',
      ownerId: 'guest',
      mode: 'unmod',
      topic: 'Working Paper & Bloc Formation',
      totalSeconds: 600,
      speakerSeconds: 0,
      totalRemainingSeconds: 600,
      speakerRemainingSeconds: 0,
      timerRunning: false,
      timerUpdatedAtMs: now,
      currentSpeakerId: '',
      yieldType: 'none',
      yieldTargetId: '',
      queue: [],
      slotsUsed: 0,
      updatedAt: now,
    },
    cow: {
      id: 'cow',
      ownerId: 'guest',
      mode: 'cow',
      topic: 'Consultation of a Whole',
      totalSeconds: 600,
      speakerSeconds: 0,
      totalRemainingSeconds: 600,
      speakerRemainingSeconds: 0,
      timerRunning: false,
      timerUpdatedAtMs: now,
      currentSpeakerId: '',
      yieldType: 'none',
      yieldTargetId: '',
      queue: [],
      slotsUsed: 0,
      updatedAt: now,
    },
    resolutions: defaultResolutionsCaucus(now),
  };

  return {
    bundles: {
      [comId]: {
        committee,
        delegates,
        sessions: [session],
        motions,
        logs,
        caucuses,
        blocs: [],
      },
    },
  };
}

function loadDb(): GuestDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestDatabase;
      if (parsed && parsed.bundles) {
        const now = Date.now();
        Object.values(parsed.bundles).forEach((b) => {
          if (!b.caucuses.opening) {
            b.caucuses.opening = defaultOpeningCaucus(now);
          }
          if (!b.caucuses.resolutions) {
            b.caucuses.resolutions = defaultResolutionsCaucus(now);
          }
          if (!b.committee.joinCode) {
            b.committee.joinCode = makeJoinCode();
          }
          if (!b.committee.memberIds) {
            b.committee.memberIds = ['guest'];
          }
        });
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  const seeded = createSeedDatabase();
  saveDb(seeded);
  return seeded;
}

function saveDb(db: GuestDatabase): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore storage quota errors
  }
  broadcastSync();
  notify();
}

export function subscribeGuestStore(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  let ch: BroadcastChannel | null = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
      ch.onmessage = () => listener();
    } catch {
      ch = null;
    }
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
    if (ch) {
      ch.close();
    }
  };
}

export function getGuestCommittees(): Committee[] {
  const db = loadDb();
  return Object.values(db.bundles)
    .map((b) => b.committee)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export function getGuestBundle(committeeId: string): GuestCommitteeBundle | null {
  const db = loadDb();
  return db.bundles[committeeId] || null;
}

export function guestCreateCommittee(
  committeeName: string,
  countries: Array<{ name: string; code: string }>,
  simpleMajorityFraction = '1/2',
  supermajorityFraction = '2/3',
  joinCode?: string
): string {
  const db = loadDb();
  const comId = makeSafeId('com');
  const sesId = makeSafeId('ses');
  const now = Date.now();
  const normalizedCode = normalizeJoinCode(joinCode || '');
  const resolvedCode = normalizedCode.length === 4 ? normalizedCode : makeJoinCode();

  const attendance: Record<string, AttendanceStatus> = {};
  const delegates: Delegate[] = countries.map((c) => {
    const delId = makeSafeId('del');
    attendance[delId] = 'absent';
    return {
      id: delId,
      ownerId: 'guest',
      countryName: clampStr(c.name, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      countryCode: clampStr(c.code.toUpperCase() || 'UN', BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
      speechesCount: 0,
      poisCount: 0,
      motionsProposedCount: 0,
      motionsAcceptedCount: 0,
      mainSubSpeechesCount: 0,
      amendmentsProposedCount: 0,
      amendmentsPassedCount: 0,
      amendmentSpeechesCount: 0,
      chairNotes: '',
      createdAt: now,
      updatedAt: now,
    };
  });

  db.bundles[comId] = {
    committee: {
      id: comId,
      ownerId: 'guest',
      name: clampStr(committeeName, BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX),
      activeSessionId: sesId,
      activeTab: 'roll_call',
      delegateCount: delegates.length,
      sessionCount: 1,
      simpleMajorityFraction: clampStr(simpleMajorityFraction || '1/2', BLUEPRINT_BOUNDS.FRACTION_MAX),
      supermajorityFraction: clampStr(supermajorityFraction || '2/3', BLUEPRINT_BOUNDS.FRACTION_MAX),
      joinCode: resolvedCode,
      memberIds: ['guest'],
      createdAt: now,
      updatedAt: now,
    },
    delegates,
    sessions: [
      {
        id: sesId,
        ownerId: 'guest',
        name: 'Session 1',
        order: 1,
        quorumRatio: 0.5,
        attendance,
        createdAt: now,
        updatedAt: now,
      },
    ],
    motions: [],
    logs: [],
    caucuses: {
      opening: defaultOpeningCaucus(now),
      gsl: {
        id: 'gsl',
        ownerId: 'guest',
        mode: 'gsl',
        topic: "General Speakers' List",
        totalSeconds: 0,
        speakerSeconds: 90,
        totalRemainingSeconds: 0,
        speakerRemainingSeconds: 90,
        timerRunning: false,
        timerUpdatedAtMs: now,
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        updatedAt: now,
      },
      mod: {
        id: 'mod',
        ownerId: 'guest',
        mode: 'mod',
        topic: '',
        totalSeconds: 600,
        speakerSeconds: 60,
        totalRemainingSeconds: 600,
        speakerRemainingSeconds: 60,
        timerRunning: false,
        timerUpdatedAtMs: now,
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        updatedAt: now,
      },
      unmod: {
        id: 'unmod',
        ownerId: 'guest',
        mode: 'unmod',
        topic: 'Working Paper & Bloc Formation',
        totalSeconds: 600,
        speakerSeconds: 0,
        totalRemainingSeconds: 600,
        speakerRemainingSeconds: 0,
        timerRunning: false,
        timerUpdatedAtMs: now,
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        updatedAt: now,
      },
      cow: {
        id: 'cow',
        ownerId: 'guest',
        mode: 'cow',
        topic: 'Consultation of a Whole',
        totalSeconds: 600,
        speakerSeconds: 0,
        totalRemainingSeconds: 600,
        speakerRemainingSeconds: 0,
        timerRunning: false,
        timerUpdatedAtMs: now,
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        updatedAt: now,
      },
      resolutions: defaultResolutionsCaucus(now),
    },
    blocs: [],
  };

  saveDb(db);
  return comId;
}

export function guestAddDelegate(
  committeeId: string,
  countryName: string,
  countryCode: string,
  activeSessionId?: string
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const delId = makeSafeId('del');
  const now = Date.now();
  b.delegates.push({
    id: delId,
    ownerId: 'guest',
    countryName: clampStr(countryName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
    countryCode: clampStr(countryCode.toUpperCase() || 'UN', BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
    speechesCount: 0,
    poisCount: 0,
    motionsProposedCount: 0,
    motionsAcceptedCount: 0,
    mainSubSpeechesCount: 0,
    amendmentsProposedCount: 0,
    amendmentsPassedCount: 0,
    amendmentSpeechesCount: 0,
    chairNotes: '',
    createdAt: now,
    updatedAt: now,
  });
  b.committee.delegateCount = b.delegates.length;
  b.committee.updatedAt = now;
  const ses = b.sessions.find((s) => s.id === activeSessionId) || b.sessions[0];
  if (ses) {
    ses.attendance[delId] = 'absent';
    ses.updatedAt = now;
  }
  saveDb(db);
}

export function guestUpdateMajorities(
  committeeId: string,
  simpleMajorityFraction: string,
  supermajorityFraction: string
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.committee.simpleMajorityFraction = clampStr(simpleMajorityFraction || '1/2', BLUEPRINT_BOUNDS.FRACTION_MAX);
  b.committee.supermajorityFraction = clampStr(supermajorityFraction || '2/3', BLUEPRINT_BOUNDS.FRACTION_MAX);
  b.committee.updatedAt = Date.now();
  saveDb(db);
}

export function guestDeleteCommittee(committeeId: string): void {
  const db = loadDb();
  delete db.bundles[committeeId];
  saveDb(db);
}

export function guestUpdateCommitteeTab(committeeId: string, activeTab: ProceduralTab): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.committee.activeTab = activeTab;
  b.committee.updatedAt = Date.now();
  saveDb(db);
}

export function guestUpdateActiveSession(committeeId: string, sessionId: string): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.committee.activeSessionId = sessionId;
  b.committee.updatedAt = Date.now();
  saveDb(db);
}

export function guestCreateNewSession(committeeId: string, nextOrder: number, delegateIds: string[]): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const sesId = makeSafeId('ses');
  const now = Date.now();
  const attendance: Record<string, AttendanceStatus> = {};
  delegateIds.forEach((id) => {
    attendance[id] = 'absent';
  });
  b.sessions.push({
    id: sesId,
    ownerId: 'guest',
    name: `Session ${nextOrder}`,
    order: nextOrder,
    quorumRatio: 0.5,
    attendance,
    createdAt: now,
    updatedAt: now,
  });
  b.committee.activeSessionId = sesId;
  b.committee.sessionCount = nextOrder;
  b.committee.updatedAt = now;
  saveDb(db);
}

export function guestUpdateAttendance(
  committeeId: string,
  sessionId: string,
  attendance: Record<string, AttendanceStatus>
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const ses = b.sessions.find((s) => s.id === sessionId);
  if (!ses) return;
  ses.attendance = attendance;
  ses.updatedAt = Date.now();
  saveDb(db);
}

export function guestUpdateQuorumRatio(
  committeeId: string,
  sessionId: string,
  quorumRatio: 0.5 | 0.333
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const ses = b.sessions.find((s) => s.id === sessionId);
  if (!ses) return;
  ses.quorumRatio = quorumRatio;
  ses.updatedAt = Date.now();
  saveDb(db);
}

export function guestCreateMotion(params: {
  committeeId: string;
  sessionId: string;
  actionType: MotionActionType;
  proposerId: string;
  proposerName: string;
  proposerCode: string;
  totalSeconds: number;
  speakerSeconds: number;
  topic: string;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();
  b.motions.push({
    id: makeSafeId('mot'),
    ownerId: 'guest',
    sessionId: params.sessionId,
    actionType: params.actionType,
    proposerId: params.proposerId,
    proposerName: clampStr(params.proposerName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
    proposerCode: clampStr(params.proposerCode, BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
    totalSeconds: Math.max(0, Math.min(7200, Math.round(params.totalSeconds))),
    speakerSeconds: Math.max(0, Math.min(600, Math.round(params.speakerSeconds))),
    topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
    disruptivenessScore: computeDisruptivenessScore(
      params.actionType,
      params.totalSeconds,
      params.speakerSeconds
    ),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
  saveDb(db);
}

export function guestResolveMotion(params: {
  committeeId: string;
  motion: Motion;
  outcome: 'accepted' | 'rejected';
  launchCaucus: boolean;
  existingCaucus?: CaucusState;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();
  const m = b.motions.find((x) => x.id === params.motion.id);
  if (m) {
    m.status = params.outcome;
    m.updatedAt = now;
  }
  const del = b.delegates.find((d) => d.id === params.motion.proposerId);
  if (del) {
    del.motionsProposedCount += 1;
    if (params.outcome === 'accepted') {
      del.motionsAcceptedCount += 1;
    }
    del.updatedAt = now;
  }

  b.logs.unshift({
    id: makeSafeId('log'),
    ownerId: 'guest',
    sessionId: params.motion.sessionId,
    delegateId: params.motion.proposerId,
    delegateName: params.motion.proposerName,
    type: 'motion',
    caucusMode: 'Motions',
    topic: clampStr(params.motion.topic || params.motion.actionType.toUpperCase(), BLUEPRINT_BOUNDS.TOPIC_MAX),
    durationSeconds: params.motion.totalSeconds,
    targetDelegateName: '',
    yieldType: '',
    outcome: params.outcome,
    note: `${params.motion.actionType.toUpperCase()} (${params.outcome})`,
    createdAt: now,
  });

  if (params.outcome === 'accepted' && params.launchCaucus) {
    if (
      params.motion.actionType === 'mod' ||
      params.motion.actionType === 'unmod' ||
      params.motion.actionType === 'cow'
    ) {
      const mode = params.motion.actionType;
      const totalSecs = params.motion.totalSeconds > 0 ? params.motion.totalSeconds : 600;
      const speakerSecs =
        mode === 'mod' ? (params.motion.speakerSeconds > 0 ? params.motion.speakerSeconds : 60) : 0;

      b.caucuses[mode] = {
        ...b.caucuses[mode],
        topic: clampStr(params.motion.topic || `${mode.toUpperCase()} Session`, BLUEPRINT_BOUNDS.TOPIC_MAX),
        totalSeconds: totalSecs,
        speakerSeconds: speakerSecs,
        totalRemainingSeconds: totalSecs,
        speakerRemainingSeconds: speakerSecs,
        timerRunning: false,
        timerUpdatedAtMs: now,
        currentSpeakerId: mode === 'mod' ? params.motion.proposerId : '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        updatedAt: now,
      };
      b.committee.activeTab = mode;
      b.committee.updatedAt = now;
    } else if (params.motion.actionType === 'gsl') {
      if (params.motion.topic.trim()) {
        b.caucuses.gsl = {
          ...b.caucuses.gsl,
          topic: clampStr(params.motion.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
          updatedAt: now,
        };
      }
      b.committee.activeTab = 'gsl';
      b.committee.updatedAt = now;
    }
  }
  void params.existingCaucus;

  saveDb(db);
}

export function guestDeleteMotion(committeeId: string, motionId: string): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.motions = b.motions.filter((m) => m.id !== motionId);
  saveDb(db);
}

export function guestUpdateCaucusState(
  committeeId: string,
  mode: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions',
  patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const fallback =
    mode === 'opening' ? defaultOpeningCaucus(Date.now()) : defaultResolutionsCaucus(Date.now());
  b.caucuses[mode] = {
    ...(b.caucuses[mode] || fallback),
    ...patch,
    updatedAt: Date.now(),
  };
  saveDb(db);
}

export function guestLogSpeechAndAdvance(params: {
  committeeId: string;
  sessionId: string;
  caucusMode: 'Opening' | 'GSL' | 'Mod' | 'COW' | 'Resolutions';
  speakerId: string;
  speakerName: string;
  topic: string;
  durationSeconds: number;
  yieldType: YieldType;
  yieldTargetName?: string;
  note?: string;
  speechCategory?: ResolutionSpeechCategory;
  caucusPatch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();
  const modeKey = params.caucusMode.toLowerCase() as
    | 'opening'
    | 'gsl'
    | 'mod'
    | 'cow'
    | 'resolutions';

  const outcomeTag =
    params.caucusMode === 'Resolutions' && params.speechCategory
      ? params.speechCategory
      : 'completed';

  b.logs.unshift({
    id: makeSafeId('log'),
    ownerId: 'guest',
    sessionId: params.sessionId,
    delegateId: params.speakerId,
    delegateName: params.speakerName,
    type: 'speech',
    caucusMode: params.caucusMode,
    topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
    durationSeconds: Math.max(0, Math.min(7200, Math.round(params.durationSeconds))),
    targetDelegateName: clampStr(params.yieldTargetName || '', BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
    yieldType: params.yieldType === 'none' ? '' : params.yieldType,
    outcome: outcomeTag,
    note: clampStr(params.note || '', BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
    createdAt: now,
  });

  const del = b.delegates.find((d) => d.id === params.speakerId);
  if (del) {
    del.speechesCount += 1;
    if (params.caucusMode === 'Resolutions' && params.speechCategory === 'main_sub') {
      del.mainSubSpeechesCount = (del.mainSubSpeechesCount || 0) + 1;
    } else if (
      params.caucusMode === 'Resolutions' &&
      (params.speechCategory === 'amendment_for' || params.speechCategory === 'amendment_against')
    ) {
      del.amendmentSpeechesCount = (del.amendmentSpeechesCount || 0) + 1;
    }
    del.updatedAt = now;
  }

  b.caucuses[modeKey] = {
    ...b.caucuses[modeKey],
    ...params.caucusPatch,
    updatedAt: now,
  };

  saveDb(db);
}

export function guestLogDelegatePoi(params: {
  committeeId: string;
  sessionId: string;
  caucusMode: 'GSL' | 'Mod' | 'Resolutions';
  questionerId: string;
  questionerName: string;
  targetDelegateName: string;
  topic: string;
  note?: string;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();

  b.logs.unshift({
    id: makeSafeId('log'),
    ownerId: 'guest',
    sessionId: params.sessionId,
    delegateId: params.questionerId,
    delegateName: params.questionerName,
    type: 'poi',
    caucusMode: params.caucusMode,
    topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
    durationSeconds: 0,
    targetDelegateName: clampStr(params.targetDelegateName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
    yieldType: '',
    outcome: 'asked',
    note: clampStr(params.note || '', BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
    createdAt: now,
  });

  const del = b.delegates.find((d) => d.id === params.questionerId);
  if (del) {
    del.poisCount += 1;
    del.updatedAt = now;
  }

  saveDb(db);
}

export function guestLogAmendmentOutcome(params: {
  committeeId: string;
  sessionId: string;
  delegateId: string;
  delegateName: string;
  passed: boolean;
  topic: string;
  note: string;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();

  b.logs.unshift({
    id: makeSafeId('log'),
    ownerId: 'guest',
    sessionId: params.sessionId,
    delegateId: params.delegateId,
    delegateName: params.delegateName,
    type: 'amendment',
    caucusMode: 'Resolutions',
    topic: clampStr(params.topic || 'Amendment', BLUEPRINT_BOUNDS.TOPIC_MAX),
    durationSeconds: 0,
    targetDelegateName: '',
    yieldType: '',
    outcome: params.passed ? 'passed' : 'failed',
    note: clampStr(params.note, BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
    createdAt: now,
  });

  const del = b.delegates.find((d) => d.id === params.delegateId);
  if (del) {
    del.amendmentsProposedCount = (del.amendmentsProposedCount || 0) + 1;
    if (params.passed) {
      del.amendmentsPassedCount = (del.amendmentsPassedCount || 0) + 1;
    }
    del.updatedAt = now;
  }

  saveDb(db);
}

export function guestUpdateDelegateChairNotes(
  committeeId: string,
  delegateId: string,
  chairNotes: string
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const del = b.delegates.find((d) => d.id === delegateId);
  if (!del) return;
  del.chairNotes = chairNotes.slice(0, BLUEPRINT_BOUNDS.CHAIR_NOTES_MAX);
  del.updatedAt = Date.now();
  saveDb(db);
}

export function guestUpdateDelegateStats(
  committeeId: string,
  delegateId: string,
  stats: DelegateStatsPatch
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const del = b.delegates.find((d) => d.id === delegateId);
  if (!del) return;
  const clampStat = (val: number) => Math.max(0, Math.min(10000, Math.round(Number(val) || 0)));
  del.speechesCount = clampStat(stats.speechesCount);
  del.poisCount = clampStat(stats.poisCount);
  del.motionsProposedCount = clampStat(stats.motionsProposedCount);
  del.motionsAcceptedCount = clampStat(stats.motionsAcceptedCount);
  del.mainSubSpeechesCount = clampStat(stats.mainSubSpeechesCount);
  del.amendmentsProposedCount = clampStat(stats.amendmentsProposedCount);
  del.amendmentsPassedCount = clampStat(stats.amendmentsPassedCount);
  del.amendmentSpeechesCount = clampStat(stats.amendmentSpeechesCount);
  del.updatedAt = Date.now();
  saveDb(db);
}

export function guestUpdateActivityLogNote(
  committeeId: string,
  logId: string,
  note: string
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  const entry = b.logs.find((l) => l.id === logId);
  if (!entry) return;
  entry.note = note.slice(0, BLUEPRINT_BOUNDS.LOG_NOTE_MAX);
  saveDb(db);
}

export function guestDeleteActivityLogEntry(
  committeeId: string,
  logId: string,
  delegateId: string,
  type: 'speech' | 'poi' | 'motion' | 'amendment',
  outcome: string
): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.logs = b.logs.filter((l) => l.id !== logId);
  const del = b.delegates.find((d) => d.id === delegateId);
  if (del) {
    if (type === 'speech') {
      del.speechesCount = Math.max(0, del.speechesCount - 1);
      if (outcome === 'main_sub') {
        del.mainSubSpeechesCount = Math.max(0, (del.mainSubSpeechesCount || 0) - 1);
      } else if (
        outcome === 'amendment' ||
        outcome === 'amendment_for' ||
        outcome === 'amendment_against'
      ) {
        del.amendmentSpeechesCount = Math.max(0, (del.amendmentSpeechesCount || 0) - 1);
      }
    } else if (type === 'poi') {
      del.poisCount = Math.max(0, del.poisCount - 1);
    } else if (type === 'motion') {
      del.motionsProposedCount = Math.max(0, del.motionsProposedCount - 1);
      if (outcome === 'accepted') {
        del.motionsAcceptedCount = Math.max(0, del.motionsAcceptedCount - 1);
      }
    } else if (type === 'amendment') {
      del.amendmentsProposedCount = Math.max(0, (del.amendmentsProposedCount || 0) - 1);
      if (outcome === 'passed') {
        del.amendmentsPassedCount = Math.max(0, (del.amendmentsPassedCount || 0) - 1);
      }
    }
    del.updatedAt = Date.now();
  }
  saveDb(db);
}

export function guestCreateUnmodBloc(params: {
  committeeId: string;
  sessionId: string;
  title: string;
  sponsors: string;
  notes: string;
}): void {
  const db = loadDb();
  const b = db.bundles[params.committeeId];
  if (!b) return;
  const now = Date.now();
  b.blocs.unshift({
    id: makeSafeId('bloc'),
    ownerId: 'guest',
    sessionId: params.sessionId,
    title: clampStr(params.title, BLUEPRINT_BOUNDS.BLOC_TITLE_MAX),
    sponsors: clampStr(params.sponsors, BLUEPRINT_BOUNDS.BLOC_SPONSORS_MAX),
    notes: clampStr(params.notes, BLUEPRINT_BOUNDS.BLOC_NOTES_MAX),
    createdAt: now,
    updatedAt: now,
  });
  saveDb(db);
}

export function guestDeleteUnmodBloc(committeeId: string, blocId: string): void {
  const db = loadDb();
  const b = db.bundles[committeeId];
  if (!b) return;
  b.blocs = b.blocs.filter((x) => x.id !== blocId);
  saveDb(db);
}
