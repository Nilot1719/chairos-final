import type {
  AttendanceStatus,
  Delegate,
  Motion,
  MotionActionType,
  QuorumMetrics,
  ResolutionSpeechCategory,
  Session,
} from '../types/mun';

export const RESOLUTION_SPEECH_CATEGORIES: Array<{
  key: ResolutionSpeechCategory;
  label: string;
}> = [
  { key: 'main_sub', label: 'Main Sub' },
  { key: 'for', label: 'For' },
  { key: 'against', label: 'Against' },
  { key: 'to', label: 'TO' },
  { key: 'amendment_for', label: 'Amendment For' },
  { key: 'amendment_against', label: 'Amendment Against' },
];

export const BLUEPRINT_BOUNDS = {
  COMMITTEE_NAME_MAX: 120,
  DELEGATE_NAME_MAX: 100,
  DELEGATE_CODE_MAX: 10,
  CHAIR_NOTES_MAX: 5000,
  SESSION_NAME_MAX: 80,
  TOPIC_MAX: 200,
  LOG_NOTE_MAX: 500,
  BLOC_TITLE_MAX: 120,
  BLOC_SPONSORS_MAX: 400,
  BLOC_NOTES_MAX: 2000,
  FRACTION_MAX: 20,
} as const;

export const MOTION_LABELS: Record<MotionActionType, string> = {
  unmod: 'Unmoderated Caucus',
  cow: 'Consultation of a Whole (COW)',
  mod: 'Moderated Caucus',
  gsl: "General Speakers' List (GSL)",
  other: 'Other (Custom Motion)',
};

export const MOTION_SHORT_LABELS: Record<MotionActionType, string> = {
  unmod: 'UNMOD',
  cow: 'COW',
  mod: 'MOD',
  gsl: 'GSL',
  other: 'OTHER',
};

export function computeDisruptivenessScore(
  actionType: MotionActionType | string,
  totalSeconds: number,
  speakerSeconds: number
): number {
  const safeTotal = Math.max(0, Math.min(7200, Math.round(totalSeconds)));
  const safeSpeaker = Math.max(0, Math.min(600, Math.round(speakerSeconds)));

  switch (actionType) {
    case 'unmod':
      return 80000 + safeTotal;
    case 'cow':
      return 65000 + safeTotal;
    case 'mod':
      return 40000 + safeTotal * 2 + Math.max(0, 600 - safeSpeaker);
    case 'gsl':
      return 25000 + safeSpeaker;
    case 'other':
    default:
      return 10000;
  }
}

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationBadge(totalSeconds: number, speakerSeconds: number): string {
  const totalMins = Math.floor(totalSeconds / 60);
  const totalRem = totalSeconds % 60;
  const totalStr =
    totalRem === 0 ? `${totalMins}` : `${totalMins}:${String(totalRem).padStart(2, '0')}`;

  if (speakerSeconds > 0) {
    const spStr =
      speakerSeconds % 60 === 0 ? `${speakerSeconds / 60}` : `${speakerSeconds}s`;
    return `${totalStr}/${spStr}`;
  }
  return `${totalStr}m`;
}

export function formatMotionDescription(motion: Motion): string {
  const rawType = motion.actionType as string;
  const short =
    MOTION_SHORT_LABELS[rawType as MotionActionType] || rawType.toUpperCase();
  const topicText = motion.topic.trim();

  if (rawType === 'other') {
    return topicText ? `${short}: ${topicText}` : short;
  }

  const hasTime = ['unmod', 'mod', 'cow', 'suspend', 'extend'].includes(rawType);
  const timePart =
    hasTime && motion.totalSeconds > 0
      ? ` of ${formatDurationBadge(motion.totalSeconds, rawType === 'mod' ? motion.speakerSeconds : 0)}`
      : '';
  const topicPart = topicText ? ` on ${topicText}` : '';
  return `${short}${timePart}${topicPart}`;
}

export function parseFraction(
  input: string | undefined,
  fallbackNum: number,
  fallbackDen: number
): { num: number; den: number; label: string; ratio: number } {
  const raw = (input || '').trim();
  const slashMatch = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (slashMatch) {
    const num = Number(slashMatch[1]);
    const den = Number(slashMatch[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0 && num <= den) {
      return { num, den, label: `${slashMatch[1]}/${slashMatch[2]}`, ratio: num / den };
    }
  }
  const numOnly = Number(raw);
  if (raw !== '' && Number.isFinite(numOnly) && numOnly > 0 && numOnly <= 1) {
    return { num: numOnly, den: 1, label: raw, ratio: numOnly };
  }
  return {
    num: fallbackNum,
    den: fallbackDen,
    label: `${fallbackNum}/${fallbackDen}`,
    ratio: fallbackNum / fallbackDen,
  };
}

export function computeThresholdVotes(
  activeTotal: number,
  fractionStr: string | undefined,
  fallbackNum: number,
  fallbackDen: number,
  strictOverHalfWhenHalf: boolean
): { votes: number; label: string } {
  const parsed = parseFraction(fractionStr, fallbackNum, fallbackDen);
  if (activeTotal <= 0) {
    return { votes: 0, label: parsed.label };
  }
  if (strictOverHalfWhenHalf && Math.abs(parsed.ratio - 0.5) < 0.0001) {
    return { votes: Math.floor(activeTotal / 2) + 1, label: parsed.label };
  }
  return {
    votes: Math.min(activeTotal, Math.ceil(activeTotal * parsed.ratio)),
    label: parsed.label,
  };
}

export function computeQuorumMetrics(
  delegates: Delegate[],
  session: Session | undefined,
  simpleMajorityFraction?: string,
  supermajorityFraction?: string
): QuorumMetrics {
  const totalDelegations = delegates.length;
  let presentCount = 0;
  let pvCount = 0;
  let absentCount = 0;

  for (const d of delegates) {
    const status: AttendanceStatus = session?.attendance?.[d.id] || 'absent';
    if (status === 'pv') {
      pvCount += 1;
    } else if (status === 'present') {
      presentCount += 1;
    } else {
      absentCount += 1;
    }
  }

  const activeTotal = presentCount + pvCount;
  const ratio = session?.quorumRatio ?? 0.5;
  const quorumNeeded = totalDelegations === 0 ? 0 : Math.ceil(totalDelegations * ratio);
  const quorumMet = totalDelegations > 0 && activeTotal >= quorumNeeded;

  const simple = computeThresholdVotes(activeTotal, simpleMajorityFraction, 1, 2, true);
  const superMaj = computeThresholdVotes(activeTotal, supermajorityFraction, 2, 3, false);

  return {
    totalDelegations,
    presentCount,
    pvCount,
    absentCount,
    activeTotal,
    quorumNeeded,
    quorumMet,
    simpleMajority: simple.votes,
    twoThirdsMajority: superMaj.votes,
    simpleFractionLabel: simple.label,
    superFractionLabel: superMaj.label,
  };
}

export function computeDelegateTotalScore(d: Delegate): number {
  return (
    (d.speechesCount || 0) +
    (d.poisCount || 0) +
    (d.motionsProposedCount || 0) +
    (d.amendmentsProposedCount || 0)
  );
}

/**
 * Returns an accessible background color ranging from dark red (#7F1D1D)
 * through muted amber (#92400E) to bright green (#16A34A) based on relative rank.
 */
export function getRankHeatColors(
  value: number,
  allValues: number[]
): { backgroundColor: string; color: string; borderColor: string } {
  if (allValues.length === 0) {
    return { backgroundColor: '#7F1D1D', color: '#FFFFFF', borderColor: '#7F1D1D' };
  }

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  let t = 0;
  if (max === min) {
    t = max === 0 ? 0 : 1;
  } else {
    const below = allValues.filter((v) => v < value).length;
    const equal = allValues.filter((v) => v === value).length;
    const percentile = (below + 0.5 * (equal - 1)) / Math.max(1, allValues.length - 1);
    t = Math.max(0, Math.min(1, percentile));
  }

  // Dark Red (127, 29, 29) -> Warm Amber-Brown (146, 84, 14) -> Bright Green (22, 163, 74)
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const local = t * 2;
    r = Math.round(127 + (154 - 127) * local);
    g = Math.round(29 + (92 - 29) * local);
    b = Math.round(29 + (16 - 29) * local);
  } else {
    const local = (t - 0.5) * 2;
    r = Math.round(154 + (22 - 154) * local);
    g = Math.round(92 + (163 - 92) * local);
    b = Math.round(16 + (74 - 16) * local);
  }

  const bg = `rgb(${r}, ${g}, ${b})`;
  return {
    backgroundColor: bg,
    color: '#FFFFFF',
    borderColor: bg,
  };
}

export function clampStr(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function makeProjectorKey(): string {
  const randA = Math.random().toString(36).slice(2, 10);
  const randB = Math.random().toString(36).slice(2, 10);
  return `prj_${Date.now().toString(36)}_${randA}${randB}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

const JOIN_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const JOIN_DIGITS = '23456789';

export function makeJoinCode(): string {
  const chars = [
    JOIN_LETTERS[Math.floor(Math.random() * JOIN_LETTERS.length)],
    JOIN_LETTERS[Math.floor(Math.random() * JOIN_LETTERS.length)],
    JOIN_DIGITS[Math.floor(Math.random() * JOIN_DIGITS.length)],
    JOIN_DIGITS[Math.floor(Math.random() * JOIN_DIGITS.length)],
  ];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function normalizeJoinCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export function isValidJoinCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{4}$/.test(code);
}

export function isValidMixedJoinCode(code: string): boolean {
  return /^[A-Z0-9]{4}$/.test(code) && /[A-Z]/.test(code) && /[0-9]/.test(code);
}

export async function hashJoinPasscode(committeeId: string, password: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure Web Crypto API is required to hash join passwords.');
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(`${committeeId}:${password}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

