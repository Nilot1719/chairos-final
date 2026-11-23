import type { User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  BLUEPRINT_BOUNDS,
  clampStr,
  computeDisruptivenessScore,
  hashJoinPasscode,
  isValidJoinCodeFormat,
  isValidMixedJoinCode,
  makeJoinCode,
  makeProjectorKey,
  makeSafeId,
  normalizeJoinCode,
} from './munRules';
import type {
  AttendanceStatus,
  CaucusState,
  CommitteeMember,
  DelegateStatsPatch,
  Motion,
  MotionActionType,
  ProceduralTab,
  ProjectorSnapshot,
  ResolutionSpeechCategory,
  YieldType,
} from '../types/mun';

const CAUCUS_MODES: Array<'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions'> = [
  'opening',
  'gsl',
  'mod',
  'unmod',
  'cow',
  'resolutions',
];

function resolveMemberIds(ownerId: string, memberIds?: string[], actorId?: string): string[] {
  const set = new Set<string>([ownerId]);
  if (actorId) set.add(actorId);
  (memberIds || []).forEach((id) => {
    if (id) set.add(id);
  });
  return Array.from(set).slice(0, 25);
}

async function appendManifestId(
  committeeId: string,
  field: 'delegateIds' | 'sessionIds' | 'motionIds' | 'logIds' | 'blocIds',
  docId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'meta', 'manifest'), {
      [field]: arrayUnion(docId),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Legacy committees without a manifest backfill on setupOrRotateCommitteeJoin
  }
}

async function removeManifestId(
  committeeId: string,
  field: 'delegateIds' | 'sessionIds' | 'motionIds' | 'logIds' | 'blocIds',
  docId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'meta', 'manifest'), {
      [field]: arrayRemove(docId),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore if manifest does not exist
  }
}

async function commitChunkedUpdates(
  ops: Array<{ ref: DocumentReference; data: Record<string, unknown> }>
): Promise<void> {
  const CHUNK_SIZE = 380;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((op) => {
      batch.update(op.ref, op.data);
    });
    await batch.commit();
  }
}

export async function syncCommitteeMemberIds(
  committeeId: string,
  nextMemberIds: string[],
  knownMemberDocIds?: string[]
): Promise<void> {
  const manifestRef = doc(db, 'committees', committeeId, 'meta', 'manifest');
  const manifestSnap = await getDoc(manifestRef);
  const ops: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];

  if (manifestSnap.exists()) {
    const m = manifestSnap.data() as {
      delegateIds?: string[];
      sessionIds?: string[];
      motionIds?: string[];
      logIds?: string[];
      blocIds?: string[];
    };

    (m.delegateIds || []).forEach((id) =>
      ops.push({
        ref: doc(db, 'committees', committeeId, 'delegates', id),
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      })
    );
    (m.sessionIds || []).forEach((id) =>
      ops.push({
        ref: doc(db, 'committees', committeeId, 'sessions', id),
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      })
    );
    (m.motionIds || []).forEach((id) =>
      ops.push({
        ref: doc(db, 'committees', committeeId, 'motions', id),
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      })
    );
    (m.logIds || []).forEach((id) =>
      ops.push({
        ref: doc(db, 'committees', committeeId, 'logs', id),
        data: { memberIds: nextMemberIds },
      })
    );
    (m.blocIds || []).forEach((id) =>
      ops.push({
        ref: doc(db, 'committees', committeeId, 'blocs', id),
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      })
    );
    ops.push({
      ref: manifestRef,
      data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
    });
  }

  const caucusSnaps = await Promise.all(
    CAUCUS_MODES.map((mode) => getDoc(doc(db, 'committees', committeeId, 'caucuses', mode)))
  );
  caucusSnaps.forEach((snap) => {
    if (snap.exists()) {
      ops.push({
        ref: snap.ref,
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      });
    }
  });

  const memberDocIds = Array.from(new Set([...(knownMemberDocIds || []), ...nextMemberIds]));
  const memberSnaps = await Promise.all(
    memberDocIds.map((uid) => getDoc(doc(db, 'committees', committeeId, 'members', uid)))
  );
  memberSnaps.forEach((snap) => {
    if (snap.exists()) {
      ops.push({
        ref: snap.ref,
        data: { memberIds: nextMemberIds, updatedAt: serverTimestamp() },
      });
    }
  });

  if (ops.length > 0) {
    await commitChunkedUpdates(ops);
  }
}

async function allocateUniqueJoinCode(preferredCode?: string): Promise<string> {
  if (preferredCode) {
    const clean = normalizeJoinCode(preferredCode);
    if (!isValidMixedJoinCode(clean)) {
      throw new Error('Join code must be 4 characters with both letters and numbers (e.g., K7M3).');
    }
    const existing = await getDoc(doc(db, 'committeeInvites', clean));
    if (existing.exists()) {
      throw new Error(`Join code "${clean}" is already in use. Choose another or click Regenerate.`);
    }
    return clean;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = makeJoinCode();
    const existing = await getDoc(doc(db, 'committeeInvites', candidate));
    if (!existing.exists()) {
      return candidate;
    }
  }
  throw new Error('Could not allocate an unused 4-character join code. Please try again.');
}

export async function syncUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const existingSnap = await getDoc(ref);
    const displayName = clampStr(user.displayName || user.email || 'Chair', 120);
    const photoURL = clampStr(user.photoURL || '', 500);

    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createCommitteeWithRoster(
  ownerId: string,
  committeeName: string,
  countries: Array<{ name: string; code: string }>,
  simpleMajorityFraction = '1/2',
  supermajorityFraction = '2/3',
  options?: {
    joinCode?: string;
    password: string;
    ownerDisplayName?: string;
  }
): Promise<string> {
  const committeeId = makeSafeId('com');
  const sessionId = makeSafeId('ses');
  const path = `committees/${committeeId}`;

  const password = options?.password || '';
  if (password.trim().length < 4) {
    throw new Error('Please set a co-chair join password (at least 4 characters).');
  }

  try {
    const resolvedJoinCode = await allocateUniqueJoinCode(options?.joinCode);
    const passcodeHash = await hashJoinPasscode(committeeId, password);
    const cleanCommitteeName = clampStr(committeeName, BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX);
    const memberIds = [ownerId];

    const batch = writeBatch(db);
    const committeeRef = doc(db, 'committees', committeeId);
    const sessionRef = doc(db, 'committees', committeeId, 'sessions', sessionId);
    const inviteRef = doc(db, 'committeeInvites', resolvedJoinCode);
    const secretRef = doc(db, 'committeeInvites', resolvedJoinCode, 'secrets', 'lock');
    const ownerMemberRef = doc(db, 'committees', committeeId, 'members', ownerId);
    const manifestRef = doc(db, 'committees', committeeId, 'meta', 'manifest');

    const attendance: Record<string, AttendanceStatus> = {};
    const delegateIds: string[] = [];

    countries.forEach((country) => {
      const delegateId = makeSafeId('del');
      delegateIds.push(delegateId);
      attendance[delegateId] = 'absent';
      const delRef = doc(db, 'committees', committeeId, 'delegates', delegateId);
      batch.set(delRef, {
        ownerId,
        memberIds,
        countryName: clampStr(country.name, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
        countryCode: clampStr(country.code.toUpperCase() || 'UN', BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
        speechesCount: 0,
        poisCount: 0,
        motionsProposedCount: 0,
        motionsAcceptedCount: 0,
        mainSubSpeechesCount: 0,
        amendmentsProposedCount: 0,
        amendmentsPassedCount: 0,
        amendmentSpeechesCount: 0,
        chairNotes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    batch.set(committeeRef, {
      ownerId,
      memberIds,
      joinCode: resolvedJoinCode,
      name: cleanCommitteeName,
      activeSessionId: sessionId,
      activeTab: 'roll_call',
      delegateCount: countries.length,
      sessionCount: 1,
      simpleMajorityFraction: clampStr(simpleMajorityFraction || '1/2', BLUEPRINT_BOUNDS.FRACTION_MAX),
      supermajorityFraction: clampStr(supermajorityFraction || '2/3', BLUEPRINT_BOUNDS.FRACTION_MAX),
      projectorKey: makeProjectorKey(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(inviteRef, {
      committeeId,
      committeeName: cleanCommitteeName,
      ownerId,
      joinCode: resolvedJoinCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(secretRef, {
      ownerId,
      committeeId,
      joinCode: resolvedJoinCode,
      passcodeHash,
      updatedAt: serverTimestamp(),
    });

    batch.set(ownerMemberRef, {
      uid: ownerId,
      committeeId,
      ownerId,
      displayName: clampStr(options?.ownerDisplayName || 'Head Chair', 120),
      joinCode: resolvedJoinCode,
      passcodeProof: '',
      memberIds,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(manifestRef, {
      ownerId,
      memberIds,
      delegateIds,
      sessionIds: [sessionId],
      motionIds: [],
      logIds: [],
      blocIds: [],
      updatedAt: serverTimestamp(),
    });

    batch.set(sessionRef, {
      ownerId,
      memberIds,
      name: 'Session 1',
      order: 1,
      quorumRatio: 0.5,
      attendance,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const modes: Array<{
      mode: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions';
      total: number;
      speaker: number;
      topic: string;
    }> = [
      { mode: 'opening', total: 0, speaker: 60, topic: 'Opening Speeches' },
      { mode: 'gsl', total: 0, speaker: 90, topic: "General Speakers' List" },
      { mode: 'mod', total: 600, speaker: 60, topic: '' },
      { mode: 'unmod', total: 600, speaker: 0, topic: 'Working Paper & Bloc Formation' },
      { mode: 'cow', total: 600, speaker: 0, topic: 'Consultation of a Whole' },
      { mode: 'resolutions', total: 180, speaker: 90, topic: 'Main Submitter Speech' },
    ];

    modes.forEach((m) => {
      const caucusRef = doc(db, 'committees', committeeId, 'caucuses', m.mode);
      batch.set(caucusRef, {
        ownerId,
        memberIds,
        mode: m.mode,
        topic: m.topic,
        totalSeconds: m.total,
        speakerSeconds: m.speaker,
        totalRemainingSeconds: m.total,
        speakerRemainingSeconds: m.speaker,
        timerRunning: false,
        timerUpdatedAtMs: Date.now(),
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        ...(m.mode === 'resolutions' ? { subMode: 'speech', speechCategory: 'main_sub' } : {}),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    return committeeId;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Join code') || error.message.includes('password'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function joinCommitteeByCode(
  user: User,
  rawCode: string,
  password: string
): Promise<{ committeeId: string; committeeName: string; alreadyMember: boolean }> {
  const code = normalizeJoinCode(rawCode);
  if (!isValidJoinCodeFormat(code)) {
    throw new Error('Enter a valid 4-character committee code (letters & numbers).');
  }
  if (!password) {
    throw new Error('Enter the committee join password.');
  }

  const inviteRef = doc(db, 'committeeInvites', code);
  let inviteSnap;
  try {
    inviteSnap = await getDoc(inviteRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `committeeInvites/${code}`);
  }

  if (!inviteSnap || !inviteSnap.exists()) {
    throw new Error(`No committee found for join code "${code}".`);
  }

  const inviteData = inviteSnap.data() as {
    committeeId: string;
    committeeName: string;
    ownerId: string;
  };
  const { committeeId, committeeName, ownerId } = inviteData;

  try {
    const existingComSnap = await getDoc(doc(db, 'committees', committeeId));
    if (existingComSnap.exists()) {
      const data = existingComSnap.data() as { ownerId?: string; memberIds?: string[] };
      if (data.ownerId === user.uid || (data.memberIds || []).includes(user.uid)) {
        return { committeeId, committeeName, alreadyMember: true };
      }
    }
  } catch {
    // Expected when non-member cannot read committee prior to join
  }

  const passcodeProof = await hashJoinPasscode(committeeId, password);
  const initialMemberIds = ownerId === user.uid ? [ownerId] : [ownerId, user.uid];

  const batch = writeBatch(db);
  batch.set(doc(db, 'committees', committeeId, 'members', user.uid), {
    uid: user.uid,
    committeeId,
    ownerId,
    displayName: clampStr(user.displayName || user.email || 'Co-Chair', 120),
    joinCode: code,
    passcodeProof,
    memberIds: initialMemberIds,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'committees', committeeId), {
    memberIds: arrayUnion(user.uid),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('permission') || msg.includes('insufficient')) {
      throw new Error('Incorrect join code or password.');
    }
    handleFirestoreError(err, OperationType.WRITE, `committees/${committeeId}/members/${user.uid}`);
  }

  try {
    const comSnap = await getDoc(doc(db, 'committees', committeeId));
    const latestMemberIds: string[] =
      (comSnap.exists() ? (comSnap.data().memberIds as string[] | undefined) : undefined) ||
      initialMemberIds;
    await syncCommitteeMemberIds(committeeId, latestMemberIds);
  } catch (err) {
    console.error('Co-chair subcollection sync warning:', err);
  }

  return { committeeId, committeeName, alreadyMember: false };
}

export async function leaveCommittee(committeeId: string, uid: string): Promise<void> {
  const comRef = doc(db, 'committees', committeeId);
  try {
    const comSnap = await getDoc(comRef);
    if (!comSnap.exists()) return;
    const data = comSnap.data() as { ownerId: string; memberIds?: string[] };
    if (data.ownerId === uid) {
      throw new Error('Committee owner cannot leave; delete the committee instead.');
    }
    const existingMemberIds = data.memberIds || [data.ownerId];
    const nextMemberIds = existingMemberIds.filter((id) => id !== uid);

    await syncCommitteeMemberIds(committeeId, nextMemberIds, existingMemberIds);

    const batch = writeBatch(db);
    batch.delete(doc(db, 'committees', committeeId, 'members', uid));
    batch.update(comRef, {
      memberIds: arrayRemove(uid),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `committees/${committeeId}`);
  }
}

export async function setupOrRotateCommitteeJoin(params: {
  committeeId: string;
  ownerId: string;
  ownerDisplayName?: string;
  committeeName: string;
  password: string;
  existingJoinCode?: string;
  customJoinCode?: string;
  regenerateCode?: boolean;
}): Promise<string> {
  const { committeeId, ownerId, committeeName, password, existingJoinCode } = params;
  if (password.trim().length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }

  const comRef = doc(db, 'committees', committeeId);
  try {
    const comSnap = await getDoc(comRef);
    if (!comSnap.exists()) {
      throw new Error('Committee not found.');
    }
    const comData = comSnap.data() as {
      ownerId: string;
      memberIds?: string[];
      joinCode?: string;
    };
    const currentCode = comData.joinCode || existingJoinCode;
    const desiredCustom = params.customJoinCode ? normalizeJoinCode(params.customJoinCode) : '';

    let nextCode: string;
    if (desiredCustom && desiredCustom !== currentCode) {
      nextCode = await allocateUniqueJoinCode(desiredCustom);
    } else if (params.regenerateCode || !currentCode) {
      nextCode = await allocateUniqueJoinCode();
    } else {
      nextCode = currentCode;
    }

    const passcodeHash = await hashJoinPasscode(committeeId, password);
    const hasMemberIds = Array.isArray(comData.memberIds) && comData.memberIds.length > 0;
    const memberIds = hasMemberIds ? comData.memberIds! : [ownerId];

    // If legacy committee without memberIds or manifest, backfill subdocs + manifest first
    const manifestRef = doc(db, 'committees', committeeId, 'meta', 'manifest');
    const manifestSnap = await getDoc(manifestRef);
    if (!hasMemberIds || !manifestSnap.exists()) {
      const [delSnap, sesSnap, motSnap, logSnap, cauSnap, blocSnap] = await Promise.all([
        getDocs(query(collection(db, 'committees', committeeId, 'delegates'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'committees', committeeId, 'sessions'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'committees', committeeId, 'motions'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'committees', committeeId, 'logs'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'committees', committeeId, 'caucuses'), where('ownerId', '==', ownerId))),
        getDocs(query(collection(db, 'committees', committeeId, 'blocs'), where('ownerId', '==', ownerId))),
      ]);

      const ops: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
      delSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds, updatedAt: serverTimestamp() } }));
      sesSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds, updatedAt: serverTimestamp() } }));
      motSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds, updatedAt: serverTimestamp() } }));
      logSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds } }));
      cauSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds, updatedAt: serverTimestamp() } }));
      blocSnap.docs.forEach((d) => ops.push({ ref: d.ref, data: { memberIds, updatedAt: serverTimestamp() } }));
      if (ops.length > 0) {
        await commitChunkedUpdates(ops);
      }

      if (!manifestSnap.exists()) {
        await setDoc(manifestRef, {
          ownerId,
          memberIds,
          delegateIds: delSnap.docs.map((d) => d.id),
          sessionIds: sesSnap.docs.map((d) => d.id),
          motionIds: motSnap.docs.map((d) => d.id),
          logIds: logSnap.docs.map((d) => d.id),
          blocIds: blocSnap.docs.map((d) => d.id),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const batch = writeBatch(db);
    const committeePatch: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (nextCode !== comData.joinCode) {
      committeePatch.joinCode = nextCode;
    }
    if (!hasMemberIds) {
      committeePatch.memberIds = memberIds;
    }
    if (Object.keys(committeePatch).length > 1) {
      batch.update(comRef, committeePatch);
    }

    const ownerMemberRef = doc(db, 'committees', committeeId, 'members', ownerId);
    const ownerMemberSnap = await getDoc(ownerMemberRef);
    if (!ownerMemberSnap.exists()) {
      batch.set(ownerMemberRef, {
        uid: ownerId,
        committeeId,
        ownerId,
        displayName: clampStr(params.ownerDisplayName || 'Head Chair', 120),
        joinCode: nextCode,
        passcodeProof: '',
        memberIds,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const inviteRef = doc(db, 'committeeInvites', nextCode);
    const secretRef = doc(db, 'committeeInvites', nextCode, 'secrets', 'lock');

    if (nextCode === currentCode && currentCode) {
      const existingInvite = await getDoc(inviteRef);
      if (existingInvite.exists()) {
        batch.update(secretRef, {
          passcodeHash,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(inviteRef, {
          committeeId,
          committeeName: clampStr(committeeName, BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX),
          ownerId,
          joinCode: nextCode,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(secretRef, {
          ownerId,
          committeeId,
          joinCode: nextCode,
          passcodeHash,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      batch.set(inviteRef, {
        committeeId,
        committeeName: clampStr(committeeName, BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX),
        ownerId,
        joinCode: nextCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(secretRef, {
        ownerId,
        committeeId,
        joinCode: nextCode,
        passcodeHash,
        updatedAt: serverTimestamp(),
      });

      if (currentCode) {
        batch.delete(doc(db, 'committeeInvites', currentCode, 'secrets', 'lock'));
        batch.delete(doc(db, 'committeeInvites', currentCode));
      }
    }

    await batch.commit();
    return nextCode;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Join code') || error.message.includes('Password'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `committees/${committeeId}`);
  }
}

export async function fetchCommitteeMembers(
  committeeId: string,
  uid: string,
  hasMemberIds: boolean
): Promise<CommitteeMember[]> {
  const path = `committees/${committeeId}/members`;
  try {
    const q = query(
      collection(db, 'committees', committeeId, 'members'),
      where(hasMemberIds ? 'memberIds' : 'ownerId', hasMemberIds ? 'array-contains' : '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommitteeMember, 'id'>) }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function addDelegateToCommittee(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  countryName: string;
  countryCode: string;
  activeSessionId?: string;
  currentAttendance?: Record<string, AttendanceStatus>;
  nextDelegateCount: number;
}): Promise<string> {
  const delegateId = makeSafeId('del');
  const path = `committees/${params.committeeId}/delegates/${delegateId}`;
  const resolvedMembers = resolveMemberIds(params.ownerId, params.memberIds, params.ownerId);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'committees', params.committeeId, 'delegates', delegateId), {
      ownerId: params.ownerId,
      ...(params.memberIds ? { memberIds: resolvedMembers } : {}),
      countryName: clampStr(params.countryName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      countryCode: clampStr(params.countryCode.toUpperCase() || 'UN', BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
      speechesCount: 0,
      poisCount: 0,
      motionsProposedCount: 0,
      motionsAcceptedCount: 0,
      mainSubSpeechesCount: 0,
      amendmentsProposedCount: 0,
      amendmentsPassedCount: 0,
      amendmentSpeechesCount: 0,
      chairNotes: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'committees', params.committeeId), {
      delegateCount: params.nextDelegateCount,
      updatedAt: serverTimestamp(),
    });

    if (params.activeSessionId) {
      batch.update(doc(db, 'committees', params.committeeId, 'sessions', params.activeSessionId), {
        attendance: { ...(params.currentAttendance || {}), [delegateId]: 'absent' },
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    void appendManifestId(params.committeeId, 'delegateIds', delegateId);
    return delegateId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateCommitteeMajorities(
  committeeId: string,
  simpleMajorityFraction: string,
  supermajorityFraction: string
): Promise<void> {
  const path = `committees/${committeeId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId), {
      simpleMajorityFraction: clampStr(simpleMajorityFraction || '1/2', BLUEPRINT_BOUNDS.FRACTION_MAX),
      supermajorityFraction: clampStr(supermajorityFraction || '2/3', BLUEPRINT_BOUNDS.FRACTION_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function ensureCommitteeProjectorKey(committeeId: string): Promise<string> {
  const path = `committees/${committeeId}`;
  try {
    const ref = doc(db, 'committees', committeeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingKey = snap.data().projectorKey;
      if (typeof existingKey === 'string' && existingKey.length >= 8) {
        return existingKey;
      }
    }
    const nextKey = makeProjectorKey();
    await updateDoc(ref, {
      projectorKey: nextKey,
      updatedAt: serverTimestamp(),
    });
    return nextKey;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function syncProjectorSnapshot(
  projectorId: string,
  snapshot: Omit<ProjectorSnapshot, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `projectors/${projectorId}`;
  const ref = doc(db, 'projectors', projectorId);
  try {
    const payload = {
      ownerId: snapshot.ownerId,
      committeeId: snapshot.committeeId,
      committeeName: clampStr(snapshot.committeeName || 'Committee', BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX),
      sessionName: clampStr(snapshot.sessionName || 'Session 1', BLUEPRINT_BOUNDS.SESSION_NAME_MAX),
      activeTab: snapshot.activeTab,
      modeDisplayLabel: clampStr(snapshot.modeDisplayLabel || 'Session', 80),
      topic: clampStr(snapshot.topic || '', BLUEPRINT_BOUNDS.TOPIC_MAX),
      totalSeconds: Math.max(0, Math.min(7200, Math.round(snapshot.totalSeconds))),
      speakerSeconds: Math.max(0, Math.min(600, Math.round(snapshot.speakerSeconds))),
      totalRemainingSeconds: Math.max(0, Math.min(7200, Math.round(snapshot.totalRemainingSeconds))),
      speakerRemainingSeconds: Math.max(0, Math.min(600, Math.round(snapshot.speakerRemainingSeconds))),
      timerRunning: Boolean(snapshot.timerRunning),
      timerUpdatedAtMs: Math.max(0, Number(snapshot.timerUpdatedAtMs) || 0),
      isResReading: Boolean(snapshot.isResReading),
      currentSpeakerName: clampStr(snapshot.currentSpeakerName || '', BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      currentSpeakerCode: clampStr(snapshot.currentSpeakerCode || '', BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
      yieldType: snapshot.yieldType,
      upcomingQueue: (snapshot.upcomingQueue || []).slice(0, 10),
      activeTotal: Math.max(0, Math.min(500, Math.round(snapshot.activeTotal))),
      totalDelegations: Math.max(0, Math.min(500, Math.round(snapshot.totalDelegations))),
      pvCount: Math.max(0, Math.min(500, Math.round(snapshot.pvCount))),
      quorumNeeded: Math.max(0, Math.min(500, Math.round(snapshot.quorumNeeded))),
      quorumMet: Boolean(snapshot.quorumMet),
      simpleMajority: Math.max(0, Math.min(500, Math.round(snapshot.simpleMajority))),
      twoThirdsMajority: Math.max(0, Math.min(500, Math.round(snapshot.twoThirdsMajority))),
      simpleFractionLabel: clampStr(snapshot.simpleFractionLabel || '1/2', BLUEPRINT_BOUNDS.FRACTION_MAX),
      superFractionLabel: clampStr(snapshot.superFractionLabel || '2/3', BLUEPRINT_BOUNDS.FRACTION_MAX),
    };

    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCommitteeCascade(committeeId: string, actorUid: string): Promise<void> {
  const path = `committees/${committeeId}`;
  try {
    const comSnap = await getDoc(doc(db, 'committees', committeeId));
    const comData = comSnap.exists()
      ? (comSnap.data() as { projectorKey?: string; joinCode?: string; memberIds?: string[] })
      : {};
    const hasMemberIds = Array.isArray(comData.memberIds) && comData.memberIds.length > 0;
    const subcollections = ['delegates', 'sessions', 'motions', 'logs', 'caucuses', 'blocs', 'members'];
    for (const sub of subcollections) {
      const q = query(
        collection(db, 'committees', committeeId, sub),
        where(hasMemberIds ? 'memberIds' : 'ownerId', hasMemberIds ? 'array-contains' : '==', actorUid)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 380) {
          const batch = writeBatch(db);
          docs.slice(i, i + 380).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    }

    try {
      await deleteDoc(doc(db, 'committees', committeeId, 'meta', 'manifest'));
    } catch {
      // ignore if manifest did not exist
    }

    if (typeof comData.joinCode === 'string' && comData.joinCode.length === 4) {
      try {
        await deleteDoc(doc(db, 'committeeInvites', comData.joinCode, 'secrets', 'lock'));
        await deleteDoc(doc(db, 'committeeInvites', comData.joinCode));
      } catch {
        // ignore if invite was already removed
      }
    }

    if (typeof comData.projectorKey === 'string' && comData.projectorKey.length >= 1) {
      try {
        await deleteDoc(doc(db, 'projectors', comData.projectorKey));
      } catch {
        // ignore if projector snapshot was never created
      }
    }
    await deleteDoc(doc(db, 'committees', committeeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateCommitteeTab(committeeId: string, activeTab: ProceduralTab): Promise<void> {
  const path = `committees/${committeeId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId), {
      activeTab,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateActiveSession(committeeId: string, activeSessionId: string): Promise<void> {
  const path = `committees/${committeeId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId), {
      activeSessionId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createNewSession(
  committeeId: string,
  ownerId: string,
  nextOrder: number,
  delegateIds: string[],
  memberIds?: string[]
): Promise<string> {
  const sessionId = makeSafeId('ses');
  const path = `committees/${committeeId}/sessions/${sessionId}`;
  const resolvedMembers = resolveMemberIds(ownerId, memberIds, ownerId);
  try {
    const attendance: Record<string, AttendanceStatus> = {};
    delegateIds.forEach((id) => {
      attendance[id] = 'absent';
    });

    const batch = writeBatch(db);
    batch.set(doc(db, 'committees', committeeId, 'sessions', sessionId), {
      ownerId,
      ...(memberIds ? { memberIds: resolvedMembers } : {}),
      name: `Session ${nextOrder}`,
      order: nextOrder,
      quorumRatio: 0.5,
      attendance,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'committees', committeeId), {
      activeSessionId: sessionId,
      sessionCount: nextOrder,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    void appendManifestId(committeeId, 'sessionIds', sessionId);
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateSessionAttendance(
  committeeId: string,
  sessionId: string,
  attendance: Record<string, AttendanceStatus>
): Promise<void> {
  const path = `committees/${committeeId}/sessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'sessions', sessionId), {
      attendance,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSessionQuorumRatio(
  committeeId: string,
  sessionId: string,
  quorumRatio: 0.5 | 0.333
): Promise<void> {
  const path = `committees/${committeeId}/sessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'sessions', sessionId), {
      quorumRatio,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createMotion(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  sessionId: string;
  actionType: MotionActionType;
  proposerId: string;
  proposerName: string;
  proposerCode: string;
  totalSeconds: number;
  speakerSeconds: number;
  topic: string;
}): Promise<string> {
  const motionId = makeSafeId('mot');
  const path = `committees/${params.committeeId}/motions/${motionId}`;
  const resolvedMembers = resolveMemberIds(params.ownerId, params.memberIds, params.ownerId);
  try {
    const score = computeDisruptivenessScore(
      params.actionType,
      params.totalSeconds,
      params.speakerSeconds
    );
    await setDoc(doc(db, 'committees', params.committeeId, 'motions', motionId), {
      ownerId: params.ownerId,
      ...(params.memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId: params.sessionId,
      actionType: params.actionType,
      proposerId: params.proposerId,
      proposerName: clampStr(params.proposerName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      proposerCode: clampStr(params.proposerCode, BLUEPRINT_BOUNDS.DELEGATE_CODE_MAX),
      totalSeconds: Math.max(0, Math.min(7200, Math.round(params.totalSeconds))),
      speakerSeconds: Math.max(0, Math.min(600, Math.round(params.speakerSeconds))),
      topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
      disruptivenessScore: score,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void appendManifestId(params.committeeId, 'motionIds', motionId);
    return motionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function resolveMotion(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  motion: Motion;
  outcome: 'accepted' | 'rejected';
  launchCaucus: boolean;
  existingCaucus?: CaucusState;
}): Promise<void> {
  const { committeeId, ownerId, memberIds, motion, outcome, launchCaucus, existingCaucus } = params;
  const path = `committees/${committeeId}/motions/${motion.id}`;
  const logId = makeSafeId('log');
  const resolvedMembers = resolveMemberIds(ownerId, memberIds, ownerId);

  try {
    const batch = writeBatch(db);
    const motionRef = doc(db, 'committees', committeeId, 'motions', motion.id);
    const delegateRef = doc(db, 'committees', committeeId, 'delegates', motion.proposerId);
    const logRef = doc(db, 'committees', committeeId, 'logs', logId);

    batch.update(motionRef, {
      status: outcome,
      updatedAt: serverTimestamp(),
    });

    if (outcome === 'accepted') {
      batch.update(delegateRef, {
        motionsProposedCount: increment(1),
        motionsAcceptedCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(delegateRef, {
        motionsProposedCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(logRef, {
      ownerId,
      ...(memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId: motion.sessionId,
      delegateId: motion.proposerId,
      delegateName: motion.proposerName,
      type: 'motion',
      caucusMode: 'Motions',
      topic: clampStr(motion.topic || motion.actionType.toUpperCase(), BLUEPRINT_BOUNDS.TOPIC_MAX),
      durationSeconds: motion.totalSeconds,
      targetDelegateName: '',
      yieldType: '',
      outcome,
      note: clampStr(
        `${motion.actionType.toUpperCase()} (${outcome})`,
        BLUEPRINT_BOUNDS.LOG_NOTE_MAX
      ),
      createdAt: serverTimestamp(),
    });

    if (outcome === 'accepted' && launchCaucus) {
      if (motion.actionType === 'mod' || motion.actionType === 'unmod' || motion.actionType === 'cow') {
        const mode = motion.actionType;
        const caucusRef = doc(db, 'committees', committeeId, 'caucuses', mode);
        const totalSecs = motion.totalSeconds > 0 ? motion.totalSeconds : 600;
        const speakerSecs = mode === 'mod' ? (motion.speakerSeconds > 0 ? motion.speakerSeconds : 60) : 0;

        batch.update(caucusRef, {
          topic: clampStr(motion.topic || `${mode.toUpperCase()} Session`, BLUEPRINT_BOUNDS.TOPIC_MAX),
          totalSeconds: totalSecs,
          speakerSeconds: speakerSecs,
          totalRemainingSeconds: totalSecs,
          speakerRemainingSeconds: speakerSecs,
          timerRunning: false,
          timerUpdatedAtMs: Date.now(),
          currentSpeakerId: mode === 'mod' ? motion.proposerId : '',
          yieldType: 'none',
          yieldTargetId: '',
          queue: [],
          slotsUsed: 0,
          updatedAt: serverTimestamp(),
        });

        batch.update(doc(db, 'committees', committeeId), {
          activeTab: mode,
          updatedAt: serverTimestamp(),
        });
      } else if (motion.actionType === 'gsl') {
        if (motion.topic.trim()) {
          batch.update(doc(db, 'committees', committeeId, 'caucuses', 'gsl'), {
            topic: clampStr(motion.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
            updatedAt: serverTimestamp(),
          });
        }
        batch.update(doc(db, 'committees', committeeId), {
          activeTab: 'gsl',
          updatedAt: serverTimestamp(),
        });
      }
    }
    void existingCaucus;

    await batch.commit();
    void appendManifestId(committeeId, 'logIds', logId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMotion(committeeId: string, motionId: string): Promise<void> {
  const path = `committees/${committeeId}/motions/${motionId}`;
  try {
    await deleteDoc(doc(db, 'committees', committeeId, 'motions', motionId));
    void removeManifestId(committeeId, 'motionIds', motionId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateCaucusState(
  committeeId: string,
  ownerId: string,
  mode: 'opening' | 'gsl' | 'mod' | 'unmod' | 'cow' | 'resolutions',
  patch: Partial<Omit<CaucusState, 'id' | 'ownerId' | 'mode' | 'updatedAt'>>,
  memberIds?: string[]
): Promise<void> {
  const path = `committees/${committeeId}/caucuses/${mode}`;
  const ref = doc(db, 'committees', committeeId, 'caucuses', mode);
  const resolvedMembers = resolveMemberIds(ownerId, memberIds, ownerId);
  try {
    const cleanPatch: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp() };
    if (typeof cleanPatch.topic === 'string') {
      cleanPatch.topic = clampStr(cleanPatch.topic, BLUEPRINT_BOUNDS.TOPIC_MAX);
    }
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const defaultSpk = mode === 'opening' ? 60 : 90;
      const defaultTotal = mode === 'opening' || mode === 'gsl' ? 0 : 180;
      await setDoc(ref, {
        ownerId,
        ...(memberIds ? { memberIds: resolvedMembers } : {}),
        mode,
        topic: mode === 'opening' ? 'Opening Speeches' : '',
        totalSeconds: defaultTotal,
        speakerSeconds: defaultSpk,
        totalRemainingSeconds: defaultTotal,
        speakerRemainingSeconds: defaultSpk,
        timerRunning: false,
        timerUpdatedAtMs: Date.now(),
        currentSpeakerId: '',
        yieldType: 'none',
        yieldTargetId: '',
        queue: [],
        slotsUsed: 0,
        ...(mode === 'resolutions' ? { subMode: 'speech', speechCategory: 'main_sub' } : {}),
        ...cleanPatch,
      });
    } else {
      await updateDoc(ref, cleanPatch);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function logSpeechAndAdvance(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
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
}): Promise<void> {
  const { committeeId, ownerId, memberIds, sessionId, caucusMode, speakerId, speakerName } = params;
  const modeKey = caucusMode.toLowerCase() as 'opening' | 'gsl' | 'mod' | 'cow' | 'resolutions';
  const path = `committees/${committeeId}/caucuses/${modeKey}`;
  const logId = makeSafeId('log');
  const resolvedMembers = resolveMemberIds(ownerId, memberIds, ownerId);

  try {
    const batch = writeBatch(db);
    const logRef = doc(db, 'committees', committeeId, 'logs', logId);
    const delRef = doc(db, 'committees', committeeId, 'delegates', speakerId);
    const caucusRef = doc(db, 'committees', committeeId, 'caucuses', modeKey);

    const outcomeTag =
      caucusMode === 'Resolutions' && params.speechCategory
        ? params.speechCategory
        : 'completed';

    batch.set(logRef, {
      ownerId,
      ...(memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId,
      delegateId: speakerId,
      delegateName: clampStr(speakerName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      type: 'speech',
      caucusMode,
      topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
      durationSeconds: Math.max(0, Math.min(7200, Math.round(params.durationSeconds))),
      targetDelegateName: clampStr(params.yieldTargetName || '', BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      yieldType: params.yieldType === 'none' ? '' : params.yieldType,
      outcome: outcomeTag,
      note: clampStr(params.note || '', BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
      createdAt: serverTimestamp(),
    });

    if (caucusMode === 'Resolutions' && params.speechCategory === 'main_sub') {
      batch.update(delRef, {
        speechesCount: increment(1),
        mainSubSpeechesCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } else if (
      caucusMode === 'Resolutions' &&
      (params.speechCategory === 'amendment_for' || params.speechCategory === 'amendment_against')
    ) {
      batch.update(delRef, {
        speechesCount: increment(1),
        amendmentSpeechesCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(delRef, {
        speechesCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }

    batch.update(caucusRef, {
      ...params.caucusPatch,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    void appendManifestId(committeeId, 'logIds', logId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function logDelegatePoi(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  sessionId: string;
  caucusMode: 'GSL' | 'Mod' | 'Resolutions';
  questionerId: string;
  questionerName: string;
  targetDelegateName: string;
  topic: string;
  note?: string;
}): Promise<void> {
  const path = `committees/${params.committeeId}/delegates/${params.questionerId}`;
  const logId = makeSafeId('log');
  const resolvedMembers = resolveMemberIds(params.ownerId, params.memberIds, params.ownerId);
  try {
    const batch = writeBatch(db);
    const logRef = doc(db, 'committees', params.committeeId, 'logs', logId);
    const delRef = doc(db, 'committees', params.committeeId, 'delegates', params.questionerId);

    batch.set(logRef, {
      ownerId: params.ownerId,
      ...(params.memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId: params.sessionId,
      delegateId: params.questionerId,
      delegateName: clampStr(params.questionerName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      type: 'poi',
      caucusMode: params.caucusMode,
      topic: clampStr(params.topic, BLUEPRINT_BOUNDS.TOPIC_MAX),
      durationSeconds: 0,
      targetDelegateName: clampStr(params.targetDelegateName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      yieldType: '',
      outcome: 'asked',
      note: clampStr(params.note || '', BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
      createdAt: serverTimestamp(),
    });

    batch.update(delRef, {
      poisCount: increment(1),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    void appendManifestId(params.committeeId, 'logIds', logId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function logAmendmentOutcome(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  sessionId: string;
  delegateId: string;
  delegateName: string;
  passed: boolean;
  topic: string;
  note: string;
}): Promise<void> {
  const path = `committees/${params.committeeId}/delegates/${params.delegateId}`;
  const logId = makeSafeId('log');
  const resolvedMembers = resolveMemberIds(params.ownerId, params.memberIds, params.ownerId);
  try {
    const batch = writeBatch(db);
    const logRef = doc(db, 'committees', params.committeeId, 'logs', logId);
    const delRef = doc(db, 'committees', params.committeeId, 'delegates', params.delegateId);

    batch.set(logRef, {
      ownerId: params.ownerId,
      ...(params.memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId: params.sessionId,
      delegateId: params.delegateId,
      delegateName: clampStr(params.delegateName, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
      type: 'amendment',
      caucusMode: 'Resolutions',
      topic: clampStr(params.topic || 'Amendment', BLUEPRINT_BOUNDS.TOPIC_MAX),
      durationSeconds: 0,
      targetDelegateName: '',
      yieldType: '',
      outcome: params.passed ? 'passed' : 'failed',
      note: clampStr(params.note, BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
      createdAt: serverTimestamp(),
    });

    if (params.passed) {
      batch.update(delRef, {
        amendmentsProposedCount: increment(1),
        amendmentsPassedCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(delRef, {
        amendmentsProposedCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    void appendManifestId(params.committeeId, 'logIds', logId);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateDelegateChairNotes(
  committeeId: string,
  delegateId: string,
  chairNotes: string
): Promise<void> {
  const path = `committees/${committeeId}/delegates/${delegateId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'delegates', delegateId), {
      chairNotes: chairNotes.slice(0, BLUEPRINT_BOUNDS.CHAIR_NOTES_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateDelegateStats(
  committeeId: string,
  delegateId: string,
  stats: DelegateStatsPatch
): Promise<void> {
  const path = `committees/${committeeId}/delegates/${delegateId}`;
  const clampStat = (val: number) => Math.max(0, Math.min(10000, Math.round(Number(val) || 0)));
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'delegates', delegateId), {
      speechesCount: clampStat(stats.speechesCount),
      poisCount: clampStat(stats.poisCount),
      motionsProposedCount: clampStat(stats.motionsProposedCount),
      motionsAcceptedCount: clampStat(stats.motionsAcceptedCount),
      mainSubSpeechesCount: clampStat(stats.mainSubSpeechesCount),
      amendmentsProposedCount: clampStat(stats.amendmentsProposedCount),
      amendmentsPassedCount: clampStat(stats.amendmentsPassedCount),
      amendmentSpeechesCount: clampStat(stats.amendmentSpeechesCount),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateActivityLogNote(
  committeeId: string,
  logId: string,
  note: string
): Promise<void> {
  const path = `committees/${committeeId}/logs/${logId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'logs', logId), {
      note: note.slice(0, BLUEPRINT_BOUNDS.LOG_NOTE_MAX),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteActivityLogEntry(
  committeeId: string,
  logId: string,
  delegateId: string,
  type: 'speech' | 'poi' | 'motion' | 'amendment',
  outcome: string
): Promise<void> {
  const path = `committees/${committeeId}/logs/${logId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'committees', committeeId, 'logs', logId));
    const delRef = doc(db, 'committees', committeeId, 'delegates', delegateId);

    if (type === 'speech') {
      if (outcome === 'main_sub') {
        batch.update(delRef, {
          speechesCount: increment(-1),
          mainSubSpeechesCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else if (
        outcome === 'amendment' ||
        outcome === 'amendment_for' ||
        outcome === 'amendment_against'
      ) {
        batch.update(delRef, {
          speechesCount: increment(-1),
          amendmentSpeechesCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(delRef, { speechesCount: increment(-1), updatedAt: serverTimestamp() });
      }
    } else if (type === 'poi') {
      batch.update(delRef, { poisCount: increment(-1), updatedAt: serverTimestamp() });
    } else if (type === 'motion') {
      if (outcome === 'accepted') {
        batch.update(delRef, {
          motionsProposedCount: increment(-1),
          motionsAcceptedCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(delRef, {
          motionsProposedCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      }
    } else if (type === 'amendment') {
      if (outcome === 'passed') {
        batch.update(delRef, {
          amendmentsProposedCount: increment(-1),
          amendmentsPassedCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(delRef, {
          amendmentsProposedCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
    void removeManifestId(committeeId, 'logIds', logId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createUnmodBloc(params: {
  committeeId: string;
  ownerId: string;
  memberIds?: string[];
  sessionId: string;
  title: string;
  sponsors: string;
  notes: string;
}): Promise<void> {
  const blocId = makeSafeId('bloc');
  const path = `committees/${params.committeeId}/blocs/${blocId}`;
  const resolvedMembers = resolveMemberIds(params.ownerId, params.memberIds, params.ownerId);
  try {
    await setDoc(doc(db, 'committees', params.committeeId, 'blocs', blocId), {
      ownerId: params.ownerId,
      ...(params.memberIds ? { memberIds: resolvedMembers } : {}),
      sessionId: params.sessionId,
      title: clampStr(params.title, BLUEPRINT_BOUNDS.BLOC_TITLE_MAX),
      sponsors: clampStr(params.sponsors, BLUEPRINT_BOUNDS.BLOC_SPONSORS_MAX),
      notes: clampStr(params.notes, BLUEPRINT_BOUNDS.BLOC_NOTES_MAX),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    void appendManifestId(params.committeeId, 'blocIds', blocId);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateUnmodBloc(
  committeeId: string,
  blocId: string,
  fields: { title: string; sponsors: string; notes: string }
): Promise<void> {
  const path = `committees/${committeeId}/blocs/${blocId}`;
  try {
    await updateDoc(doc(db, 'committees', committeeId, 'blocs', blocId), {
      title: clampStr(fields.title, BLUEPRINT_BOUNDS.BLOC_TITLE_MAX),
      sponsors: clampStr(fields.sponsors, BLUEPRINT_BOUNDS.BLOC_SPONSORS_MAX),
      notes: clampStr(fields.notes, BLUEPRINT_BOUNDS.BLOC_NOTES_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUnmodBloc(committeeId: string, blocId: string): Promise<void> {
  const path = `committees/${committeeId}/blocs/${blocId}`;
  try {
    await deleteDoc(doc(db, 'committees', committeeId, 'blocs', blocId));
    void removeManifestId(committeeId, 'blocIds', blocId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
