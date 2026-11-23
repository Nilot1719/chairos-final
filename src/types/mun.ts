export type ProceduralTab =
  | 'roll_call'
  | 'opening'
  | 'motions'
  | 'gsl'
  | 'mod'
  | 'unmod'
  | 'cow'
  | 'resolutions';

export type AttendanceStatus = 'absent' | 'present' | 'pv';

export type MotionActionType = 'gsl' | 'mod' | 'unmod' | 'cow' | 'other';

export type MotionStatus = 'pending' | 'accepted' | 'rejected';

export type YieldType = 'none' | 'chair' | 'pois' | 'delegate' | 'comments';

export type ResolutionSubMode = 'reading' | 'speech';
export type ResolutionSpeechCategory =
  | 'main_sub'
  | 'for'
  | 'against'
  | 'to'
  | 'amendment_for'
  | 'amendment_against';

export interface Committee {
  id: string;
  ownerId: string;
  name: string;
  activeSessionId: string;
  activeTab: ProceduralTab;
  delegateCount: number;
  sessionCount: number;
  simpleMajorityFraction?: string;
  supermajorityFraction?: string;
  projectorKey?: string;
  joinCode?: string;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommitteeMember {
  id: string;
  uid: string;
  committeeId: string;
  ownerId: string;
  displayName: string;
  joinCode: string;
  passcodeProof: string;
  memberIds: string[];
  joinedAt?: unknown;
  updatedAt?: unknown;
}

export interface DelegateStatsPatch {
  speechesCount: number;
  poisCount: number;
  motionsProposedCount: number;
  motionsAcceptedCount: number;
  mainSubSpeechesCount: number;
  amendmentsProposedCount: number;
  amendmentsPassedCount: number;
  amendmentSpeechesCount: number;
}

export interface Delegate {
  id: string;
  ownerId: string;
  countryName: string;
  countryCode: string;
  speechesCount: number;
  poisCount: number;
  motionsProposedCount: number;
  motionsAcceptedCount: number;
  mainSubSpeechesCount?: number;
  amendmentsProposedCount?: number;
  amendmentsPassedCount?: number;
  amendmentSpeechesCount?: number;
  chairNotes: string;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Session {
  id: string;
  ownerId: string;
  name: string;
  order: number;
  quorumRatio: 0.5 | 0.333;
  attendance: Record<string, AttendanceStatus>;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Motion {
  id: string;
  ownerId: string;
  sessionId: string;
  actionType: MotionActionType;
  proposerId: string;
  proposerName: string;
  proposerCode: string;
  totalSeconds: number;
  speakerSeconds: number;
  topic: string;
  disruptivenessScore: number;
  status: MotionStatus;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActivityLog {
  id: string;
  ownerId: string;
  sessionId: string;
  delegateId: string;
  delegateName: string;
  type: 'speech' | 'poi' | 'motion' | 'amendment';
  caucusMode: 'Opening' | 'GSL' | 'Mod' | 'Unmod' | 'COW' | 'Motions' | 'Resolutions';
  topic: string;
  durationSeconds: number;
  targetDelegateName: string;
  yieldType: string;
  outcome: string;
  note: string;
  memberIds?: string[];
  createdAt?: unknown;
}

export interface CaucusState {
  id: string;
  ownerId: string;
  mode: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions';
  topic: string;
  totalSeconds: number;
  speakerSeconds: number;
  totalRemainingSeconds: number;
  speakerRemainingSeconds: number;
  timerRunning: boolean;
  timerUpdatedAtMs: number;
  currentSpeakerId: string;
  yieldType: YieldType;
  yieldTargetId: string;
  queue: string[];
  slotsUsed: number;
  subMode?: ResolutionSubMode;
  speechCategory?: ResolutionSpeechCategory;
  memberIds?: string[];
  updatedAt?: unknown;
}

export interface UnmodBloc {
  id: string;
  ownerId: string;
  sessionId: string;
  title: string;
  sponsors: string;
  notes: string;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface QuorumMetrics {
  totalDelegations: number;
  presentCount: number;
  pvCount: number;
  absentCount: number;
  activeTotal: number;
  quorumNeeded: number;
  quorumMet: boolean;
  simpleMajority: number;
  twoThirdsMajority: number;
  simpleFractionLabel: string;
  superFractionLabel: string;
}

export interface ProjectorSnapshot {
  ownerId: string;
  committeeId: string;
  committeeName: string;
  sessionName: string;
  activeTab: ProceduralTab;
  modeDisplayLabel: string;
  topic: string;
  totalSeconds: number;
  speakerSeconds: number;
  totalRemainingSeconds: number;
  speakerRemainingSeconds: number;
  timerRunning: boolean;
  timerUpdatedAtMs: number;
  isResReading: boolean;
  currentSpeakerName: string;
  currentSpeakerCode: string;
  yieldType: YieldType;
  upcomingQueue: string[];
  activeTotal: number;
  totalDelegations: number;
  pvCount: number;
  quorumNeeded: number;
  quorumMet: boolean;
  simpleMajority: number;
  twoThirdsMajority: number;
  simpleFractionLabel: string;
  superFractionLabel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
