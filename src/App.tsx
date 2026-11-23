import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutChair,
  testConnection,
} from './lib/firebase';
import {
  createCommitteeWithRoster,
  deleteCommitteeCascade,
  joinCommitteeByCode,
  leaveCommittee,
  syncUserProfile,
} from './lib/committeeService';
import {
  getGuestCommittees,
  guestCreateCommittee,
  guestDeleteCommittee,
  subscribeGuestStore,
} from './lib/guestStore';
import type { Committee } from './types/mun';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingView } from './components/LandingView';
import { DashboardView } from './components/DashboardView';
import { CommitteeWorkspace } from './components/CommitteeWorkspace';
import { ProjectorScreen } from './components/ProjectorScreen';

const GUEST_SESSION_KEY = 'chairOS_guest_active';

function sortCommitteesDesc(list: Committee[]): Committee[] {
  const getMs = (ts: unknown) => {
    if (typeof ts === 'number') return ts;
    if (ts && typeof ts === 'object' && 'toMillis' in ts) {
      return (ts as { toMillis: () => number }).toMillis();
    }
    return 0;
  };
  return [...list].sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));
}

function ChairOSApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUEST_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [committees, setCommittees] = useState<Committee[]>([]);
  const [loadingCommittees, setLoadingCommittees] = useState(false);
  const [activeCommitteeId, setActiveCommitteeId] = useState<string | null>(null);

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        setIsGuest(false);
        try {
          localStorage.removeItem(GUEST_SESSION_KEY);
          await syncUserProfile(nextUser);
        } catch (err) {
          console.error('Failed to sync user profile:', err);
        }
      } else if (!localStorage.getItem(GUEST_SESSION_KEY)) {
        setCommittees([]);
        setActiveCommitteeId(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (isGuest && !user) {
      const syncGuestList = () => {
        setCommittees(getGuestCommittees());
        setLoadingCommittees(false);
      };
      syncGuestList();
      return subscribeGuestStore(syncGuestList);
    }

    if (!authReady || !user) return;
    setLoadingCommittees(true);

    const ownedMap = new Map<string, Committee>();
    const memberMap = new Map<string, Committee>();
    let ownedReady = false;
    let memberReady = false;

    const emitMerged = () => {
      if (!ownedReady && !memberReady) return;
      const merged = new Map<string, Committee>();
      ownedMap.forEach((v, k) => merged.set(k, v));
      memberMap.forEach((v, k) => merged.set(k, v));
      setCommittees(sortCommitteesDesc(Array.from(merged.values())));
      if (ownedReady && memberReady) {
        setLoadingCommittees(false);
      }
    };

    const ownedQuery = query(collection(db, 'committees'), where('ownerId', '==', user.uid));
    const memberQuery = query(
      collection(db, 'committees'),
      where('memberIds', 'array-contains', user.uid)
    );

    const unsubOwned = onSnapshot(
      ownedQuery,
      (snap) => {
        ownedMap.clear();
        snap.docs.forEach((d) => {
          ownedMap.set(d.id, { id: d.id, ...(d.data() as Omit<Committee, 'id'>) });
        });
        ownedReady = true;
        emitMerged();
      },
      (err) => {
        setLoadingCommittees(false);
        handleFirestoreError(err, OperationType.LIST, 'committees');
      }
    );

    const unsubMember = onSnapshot(
      memberQuery,
      (snap) => {
        memberMap.clear();
        snap.docs.forEach((d) => {
          memberMap.set(d.id, { id: d.id, ...(d.data() as Omit<Committee, 'id'>) });
        });
        memberReady = true;
        emitMerged();
      },
      (err) => {
        setLoadingCommittees(false);
        handleFirestoreError(err, OperationType.LIST, 'committees');
      }
    );

    return () => {
      unsubOwned();
      unsubMember();
    };
  }, [authReady, isGuest, user]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEnterGuest = () => {
    try {
      localStorage.setItem(GUEST_SESSION_KEY, 'true');
    } catch {
      // ignore storage error
    }
    setIsGuest(true);
    setActiveCommitteeId(null);
  };

  const handleSignOutOrExitGuest = () => {
    if (isGuest && !user) {
      try {
        localStorage.removeItem(GUEST_SESSION_KEY);
      } catch {
        // ignore
      }
      setIsGuest(false);
      setActiveCommitteeId(null);
      setCommittees([]);
    } else {
      signOutChair();
    }
  };

  if (!authReady && !isGuest) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Initializing ChairOS...</div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return (
      <LandingView
        onSignIn={handleSignIn}
        onEnterGuest={handleEnterGuest}
        loading={authLoading}
        error={authError}
      />
    );
  }

  if (activeCommitteeId) {
    return (
      <CommitteeWorkspace
        user={user}
        isGuest={isGuest && !user}
        committeeId={activeCommitteeId}
        onBackToDashboard={() => setActiveCommitteeId(null)}
      />
    );
  }

  return (
    <DashboardView
      user={user}
      isGuest={isGuest && !user}
      committees={committees}
      loadingCommittees={loadingCommittees}
      onEnterCommittee={(id) => setActiveCommitteeId(id)}
      onCreateCommittee={async (name, countries, simpleFraction, superFraction, joinCode, password) => {
        if (isGuest && !user) {
          const newId = guestCreateCommittee(
            name,
            countries,
            simpleFraction,
            superFraction,
            joinCode
          );
          setActiveCommitteeId(newId);
        } else if (user) {
          const newId = await createCommitteeWithRoster(
            user.uid,
            name,
            countries,
            simpleFraction,
            superFraction,
            {
              joinCode,
              password,
              ownerDisplayName: user.displayName || user.email || 'Head Chair',
            }
          );
          setActiveCommitteeId(newId);
        }
      }}
      onJoinCommittee={async (joinCode, password) => {
        if (!user) {
          throw new Error('Sign in with Google to join a shared committee.');
        }
        const res = await joinCommitteeByCode(user, joinCode, password);
        setActiveCommitteeId(res.committeeId);
      }}
      onDeleteCommittee={async (id) => {
        if (isGuest && !user) {
          guestDeleteCommittee(id);
        } else if (user) {
          await deleteCommitteeCascade(id, user.uid);
        }
      }}
      onLeaveCommittee={async (id) => {
        if (user) {
          await leaveCommittee(id, user.uid);
        }
      }}
      onSignOut={handleSignOutOrExitGuest}
      onSwitchToGoogle={handleSignIn}
    />
  );
}

export default function App() {
  const isProjectorRoute =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('projector') === '1';

  return (
    <ErrorBoundary>
      {isProjectorRoute ? <ProjectorScreen /> : <ChairOSApp />}
    </ErrorBoundary>
  );
}
