import React, { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Gavel,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { COUNTRIES, PRESET_ROSTERS } from '../data/countries';
import type { Committee } from '../types/mun';
import { CountryFlag } from './CountryFlag';
import {
  BLUEPRINT_BOUNDS,
  isValidJoinCodeFormat,
  isValidMixedJoinCode,
  makeJoinCode,
  normalizeJoinCode,
} from '../lib/munRules';
import { formatFirestoreErrorMessage } from '../lib/firebase';

interface DashboardViewProps {
  user: User | null;
  isGuest: boolean;
  committees: Committee[];
  loadingCommittees: boolean;
  onEnterCommittee: (committeeId: string) => void;
  onCreateCommittee: (
    name: string,
    countries: Array<{ name: string; code: string }>,
    simpleMajorityFraction: string,
    supermajorityFraction: string,
    joinCode: string,
    password: string
  ) => Promise<void>;
  onJoinCommittee: (joinCode: string, password: string) => Promise<void>;
  onDeleteCommittee: (committeeId: string) => Promise<void>;
  onLeaveCommittee: (committeeId: string) => Promise<void>;
  onSignOut: () => void;
  onSwitchToGoogle?: () => void;
  cloudError?: string | null;
  onDismissCloudError?: () => void;
}

export function DashboardView({
  user,
  isGuest,
  committees,
  loadingCommittees,
  onEnterCommittee,
  onCreateCommittee,
  onJoinCommittee,
  onDeleteCommittee,
  onLeaveCommittee,
  onSignOut,
  onSwitchToGoogle,
  cloudError,
  onDismissCloudError,
}: DashboardViewProps) {
  const firstName = isGuest
    ? 'Chair'
    : (user?.displayName || user?.email || 'Chair').split(' ')[0];

  const [committeeName, setCommitteeName] = useState('');
  const [simpleFraction, setSimpleFraction] = useState('1/2');
  const [superFraction, setSuperFraction] = useState('2/3');
  const [createJoinCode, setCreateJoinCode] = useState(() => makeJoinCode());
  const [createPassword, setCreatePassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinPasswordInput, setJoinPasswordInput] = useState('');
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [countryQuery, setCountryQuery] = useState('');
  const [selectedCountries, setSelectedCountries] = useState<Array<{ name: string; code: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const existingNames = new Set(selectedCountries.map((c) => c.name.toLowerCase()));
    const filtered = COUNTRIES.filter(
      (c) =>
        !existingNames.has(c.name.toLowerCase()) &&
        (q === '' || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    );
    return filtered.slice(0, 8);
  }, [countryQuery, selectedCountries]);

  const handleAddCountry = (nameInput?: string, codeInput?: string) => {
    const rawName = (nameInput ?? countryQuery).trim();
    if (!rawName) return;

    const alreadyAdded = selectedCountries.some(
      (c) => c.name.toLowerCase() === rawName.toLowerCase()
    );
    if (alreadyAdded) {
      setCountryQuery('');
      return;
    }

    const matched = COUNTRIES.find(
      (c) =>
        c.name.toLowerCase() === rawName.toLowerCase() ||
        c.code.toLowerCase() === rawName.toLowerCase()
    );

    const fallbackCode = (codeInput || rawName.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 3).toUpperCase();
    const nextCountry = matched
      ? { name: matched.name, code: matched.code }
      : {
          name: rawName.slice(0, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX),
          code: fallbackCode.length >= 2 ? fallbackCode : 'DEL',
        };

    setSelectedCountries((prev) => [...prev, nextCountry]);
    setCountryQuery('');
    setFormError(null);
  };

  const handleApplyPreset = (presetKey: string) => {
    const names = PRESET_ROSTERS[presetKey] || [];
    const existing = new Set(selectedCountries.map((c) => c.name.toLowerCase()));
    const additions: Array<{ name: string; code: string }> = [];
    for (const name of names) {
      if (!existing.has(name.toLowerCase())) {
        const match = COUNTRIES.find((c) => c.name === name);
        if (match) additions.push({ name: match.name, code: match.code });
      }
    }
    setSelectedCountries((prev) => [...prev, ...additions]);
    setFormError(null);
  };

  const handleRemoveCountry = (name: string) => {
    setSelectedCountries((prev) => prev.filter((c) => c.name !== name));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = committeeName.trim();
    if (!cleanName) {
      setFormError('Please enter a committee name (e.g., YLSCMUN IV UNHRC).');
      return;
    }
    const cleanJoinCode = normalizeJoinCode(createJoinCode);
    if (!isValidMixedJoinCode(cleanJoinCode)) {
      setFormError('Join code must be 4 characters mixing both letters and numbers (e.g., K7M3).');
      return;
    }
    if (!isGuest && createPassword.trim().length < 4) {
      setFormError('Please set a co-chair join password (at least 4 characters).');
      return;
    }
    if (selectedCountries.length === 0) {
      setFormError('Add at least one delegation before creating the committee.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await onCreateCommittee(
        cleanName,
        selectedCountries,
        simpleFraction.trim() || '1/2',
        superFraction.trim() || '2/3',
        cleanJoinCode,
        createPassword
      );
      setCommitteeName('');
      setSimpleFraction('1/2');
      setSuperFraction('2/3');
      setCreateJoinCode(makeJoinCode());
      setCreatePassword('');
      setSelectedCountries([]);
      setCountryQuery('');
    } catch (err) {
      setFormError(formatFirestoreErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) return;
    const cleanCode = normalizeJoinCode(joinCodeInput);
    if (!isValidJoinCodeFormat(cleanCode)) {
      setJoinError('Enter the 4-character join code (letters & numbers).');
      return;
    }
    if (!joinPasswordInput) {
      setJoinError('Enter the committee join password.');
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      await onJoinCommittee(cleanCode, joinPasswordInput);
      setJoinCodeInput('');
      setJoinPasswordInput('');
    } catch (err) {
      setJoinError(formatFirestoreErrorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  const handleConfirmDeleteOrLeave = async (com: Committee) => {
    setActingId(com.id);
    try {
      if (isGuest || com.ownerId === user?.uid) {
        await onDeleteCommittee(com.id);
      } else {
        await onLeaveCommittee(com.id);
      }
      setConfirmActionId(null);
    } catch (err) {
      setJoinError(formatFirestoreErrorMessage(err));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-slate-50 flex flex-col">
      <header className="w-full bg-white border-b border-slate-200 shrink-0">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#0047AB] text-white">
              <Gavel className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              ChairOS
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-slate-600 hidden sm:inline whitespace-nowrap">
              {isGuest ? 'Guest Mode · Saved locally' : user?.displayName || user?.email}
            </span>
            {isGuest && onSwitchToGoogle && (
              <button
                type="button"
                onClick={onSwitchToGoogle}
                className="px-3 py-1.5 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Sign in with Google
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              {isGuest ? 'Exit Guest' : 'Sign Out'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-[1280px] w-full mx-auto px-6 py-6 flex flex-col overflow-hidden">
        <div className="mb-5 shrink-0">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Welcome, {firstName}!
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Open an active committee, join a co-chair with a 4-character code, or build a new roster.
          </p>
        </div>

        {cloudError && !isGuest && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3 shrink-0"
          >
            <span>{cloudError}</span>
            {onDismissCloudError && (
              <button
                type="button"
                onClick={onDismissCloudError}
                aria-label="Dismiss cloud error"
                className="p-1 text-red-500 hover:text-red-800 rounded cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-y-auto lg:overflow-hidden">
          {/* Left Column: Join Committee + Your Committees */}
          <section className="lg:col-span-5 flex flex-col gap-4 lg:h-full min-h-0 overflow-hidden">
            {/* Join as Co-Chair Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shrink-0 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#0047AB]" />
                  <h2 className="font-display text-sm font-semibold text-slate-900">
                    Join Committee as Co-Chair
                  </h2>
                </div>
                <span className="text-[11px] font-mono-tabular text-slate-400">
                  4-Char Code + Password
                </span>
              </div>

              {isGuest ? (
                <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-slate-600">
                    Sign in with Google to join another chair&apos;s live committee.
                  </p>
                  {onSwitchToGoogle && (
                    <button
                      type="button"
                      onClick={onSwitchToGoogle}
                      className="px-2.5 py-1 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Sign In
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleJoinSubmit} className="space-y-2.5">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <label htmlFor="join-code-input" className="sr-only">
                        4-Character Join Code
                      </label>
                      <input
                        id="join-code-input"
                        type="text"
                        maxLength={4}
                        value={joinCodeInput}
                        onChange={(e) => {
                          setJoinCodeInput(normalizeJoinCode(e.target.value));
                          setJoinError(null);
                        }}
                        placeholder="K7M3"
                        className="w-full px-3 py-2 text-sm font-mono-tabular font-bold uppercase tracking-widest text-center bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:bg-white focus:border-[#0047AB]"
                      />
                    </div>
                    <div className="col-span-5 relative">
                      <label htmlFor="join-password-input" className="sr-only">
                        Committee Password
                      </label>
                      <input
                        id="join-password-input"
                        type={showJoinPassword ? 'text' : 'password'}
                        value={joinPasswordInput}
                        onChange={(e) => {
                          setJoinPasswordInput(e.target.value);
                          setJoinError(null);
                        }}
                        placeholder="Password"
                        className="w-full pl-3 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowJoinPassword((s) => !s)}
                        aria-label={showJoinPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showJoinPassword ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="col-span-3">
                      <button
                        type="submit"
                        disabled={joining}
                        className="w-full h-full px-3 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {joining ? 'Joining...' : 'Join'}
                      </button>
                    </div>
                  </div>
                  {joinError && (
                    <div role="alert" className="text-xs text-red-600 font-medium">
                      {joinError}
                    </div>
                  )}
                </form>
              )}
            </div>

            <div className="flex items-baseline justify-between shrink-0">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Your Committees
              </h2>
              <span className="text-xs text-slate-500 font-mono-tabular">
                {committees.length} total
              </span>
            </div>

            {loadingCommittees ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-20 bg-white border border-slate-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
            ) : committees.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">
                  No committees yet
                </p>
                <p className="text-xs text-slate-500">
                  Enter a co-chair 4-character code above or create a new committee on the right.
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                {committees.map((com) => {
                  const isOwner = isGuest || com.ownerId === user?.uid;
                  const coChairCount = com.memberIds?.length || 1;
                  return (
                    <div
                      key={com.id}
                      className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3 hover:border-slate-300 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="font-display text-base font-semibold text-slate-900 truncate">
                            {com.name}
                          </h3>
                          {!isOwner && (
                            <span className="text-[11px] font-semibold text-[#0047AB] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                              Co-Chair
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono-tabular">
                          <span>{com.delegateCount} Delegations</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {com.sessionCount} {com.sessionCount === 1 ? 'Session' : 'Sessions'}
                          </span>
                          {com.joinCode && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-700 font-semibold">
                                Code: {com.joinCode}
                              </span>
                            </>
                          )}
                          {coChairCount > 1 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{coChairCount} Chairs</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {confirmActionId === com.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={actingId === com.id}
                              onClick={() => handleConfirmDeleteOrLeave(com)}
                              className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                            >
                              {actingId === com.id
                                ? isOwner
                                  ? 'Deleting...'
                                  : 'Leaving...'
                                : isOwner
                                  ? 'Confirm'
                                  : 'Leave'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmActionId(null)}
                              className="px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setConfirmActionId(com.id)}
                              aria-label={isOwner ? `Delete ${com.name}` : `Leave ${com.name}`}
                              title={isOwner ? 'Delete Committee' : 'Leave Committee'}
                              className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              {isOwner ? (
                                <Trash2 className="w-4 h-4" />
                              ) : (
                                <LogOut className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onEnterCommittee(com.id)}
                              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                            >
                              <span>Enter</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Column: New Committee */}
          <section className="lg:col-span-7 flex flex-col lg:h-full min-h-0 overflow-hidden">
            <h2 className="font-display text-lg font-semibold text-slate-900 mb-4 shrink-0">
              New Committee
            </h2>

            <form
              onSubmit={handleCreateSubmit}
              className="flex-1 min-h-0 overflow-y-auto bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div>
                <label
                  htmlFor="committee-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Committee Name
                </label>
                <input
                  id="committee-name"
                  type="text"
                  maxLength={BLUEPRINT_BOUNDS.COMMITTEE_NAME_MAX}
                  value={committeeName}
                  onChange={(e) => setCommitteeName(e.target.value)}
                  placeholder="e.g., YLSCMUN IV UNHRC"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                />
              </div>

              {/* Co-Chair Join Code + Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="create-join-code"
                      className="text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#0047AB]" />
                      4-Char Join Code
                    </label>
                    <button
                      type="button"
                      onClick={() => setCreateJoinCode(makeJoinCode())}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0047AB] hover:underline cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Regenerate
                    </button>
                  </div>
                  <input
                    id="create-join-code"
                    type="text"
                    maxLength={4}
                    value={createJoinCode}
                    onChange={(e) => setCreateJoinCode(normalizeJoinCode(e.target.value))}
                    placeholder="K7M3"
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular font-bold uppercase tracking-widest bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-[#0047AB]"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Mixed letters &amp; numbers for co-chairs.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="create-join-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Co-Chair Password {isGuest ? '(Cloud only)' : '*'}
                  </label>
                  <div className="relative">
                    <input
                      id="create-join-password"
                      type={showCreatePassword ? 'text' : 'password'}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder={
                        isGuest ? 'Optional in local Guest Mode' : 'Min 4 characters...'
                      }
                      className="w-full pl-3.5 pr-9 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0047AB]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePassword((s) => !s)}
                      aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showCreatePassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Required for other chairs joining with this code.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="simple-fraction"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Simple Majority Fraction
                  </label>
                  <input
                    id="simple-fraction"
                    type="text"
                    maxLength={BLUEPRINT_BOUNDS.FRACTION_MAX}
                    value={simpleFraction}
                    onChange={(e) => setSimpleFraction(e.target.value)}
                    placeholder="e.g., 1/2"
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="super-fraction"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Supermajority Fraction
                  </label>
                  <input
                    id="super-fraction"
                    type="text"
                    maxLength={BLUEPRINT_BOUNDS.FRACTION_MAX}
                    value={superFraction}
                    onChange={(e) => setSuperFraction(e.target.value)}
                    placeholder="e.g., 2/3 or 3/4"
                    className="w-full px-3.5 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="country-search"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Add Delegations
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Quick fill:</span>
                    {Object.keys(PRESET_ROSTERS).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="px-2 py-0.5 text-[11px] font-medium text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded transition-colors cursor-pointer"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="country-search"
                      type="text"
                      maxLength={BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX}
                      value={countryQuery}
                      onChange={(e) => setCountryQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (suggestions.length > 0 && countryQuery.trim().length > 0) {
                            handleAddCountry(suggestions[0].name, suggestions[0].code);
                          } else {
                            handleAddCountry();
                          }
                        }
                      }}
                      placeholder="Search country (e.g., Germany, Thailand) or type custom role..."
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddCountry()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Country
                  </button>
                </div>

                {countryQuery.trim().length > 0 && suggestions.length > 0 && (
                  <div className="mt-2 border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {suggestions.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleAddCountry(c.name, c.code)}
                        className="w-full px-3 py-2 flex items-center justify-between text-left text-sm hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5 text-slate-800">
                          <CountryFlag code={c.code} name={c.name} size="sm" />
                          <span>{c.name}</span>
                        </span>
                        <span className="text-xs font-mono-tabular text-slate-400">
                          {c.code}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Countries Added
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono-tabular text-slate-500">
                      {selectedCountries.length} selected
                    </span>
                    {selectedCountries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedCountries([])}
                        className="text-xs text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>

                {selectedCountries.length === 0 ? (
                  <div className="border border-dashed border-slate-200 rounded-lg p-5 text-center text-xs text-slate-500">
                    Search above or choose a quick-fill roster to populate delegations.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1">
                    {selectedCountries.map((country) => (
                      <span
                        key={country.name}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800"
                      >
                        <CountryFlag code={country.code} name={country.name} size="sm" />
                        <span>{country.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCountry(country.name)}
                          aria-label={`Remove ${country.name}`}
                          className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {formError}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-6 py-2.5 bg-[#0047AB] hover:bg-[#003580] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {creating ? 'Creating Committee...' : 'Create Committee'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
