import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { COUNTRIES } from '../data/countries';
import {
  BLUEPRINT_BOUNDS,
  computeDelegateTotalScore,
  getRankHeatColors,
} from '../lib/munRules';
import type { AttendanceStatus, Delegate } from '../types/mun';
import { CountryFlag } from './CountryFlag';

type SortKey = 'alpha' | 'speeches' | 'pois' | 'motions';

interface DelegateSidebarProps {
  delegates: Delegate[];
  attendance: Record<string, AttendanceStatus>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDetails: (delegateId: string) => void;
  onAddDelegate: (countryName: string, countryCode: string) => Promise<void>;
}

export function DelegateSidebar({
  delegates,
  attendance,
  collapsed,
  onToggleCollapse,
  onOpenDetails,
  onAddDelegate,
}: DelegateSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('alpha');
  const [addingOpen, setAddingOpen] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addingBusy, setAddingBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const speechValues = useMemo(() => delegates.map((d) => d.speechesCount), [delegates]);
  const poiValues = useMemo(() => delegates.map((d) => d.poisCount), [delegates]);
  const motionValues = useMemo(() => delegates.map((d) => d.motionsProposedCount), [delegates]);

  const addSuggestions = useMemo(() => {
    const q = addInput.trim().toLowerCase();
    const existing = new Set(delegates.map((d) => d.countryName.toLowerCase()));
    return COUNTRIES.filter(
      (c) =>
        !existing.has(c.name.toLowerCase()) &&
        (q === '' || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    ).slice(0, 6);
  }, [addInput, delegates]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? delegates.filter((d) => d.countryName.toLowerCase().includes(q))
      : [...delegates];

    list.sort((a, b) => {
      if (sortBy === 'speeches') {
        return b.speechesCount - a.speechesCount || a.countryName.localeCompare(b.countryName);
      }
      if (sortBy === 'pois') {
        return b.poisCount - a.poisCount || a.countryName.localeCompare(b.countryName);
      }
      if (sortBy === 'motions') {
        return (
          b.motionsProposedCount - a.motionsProposedCount ||
          a.countryName.localeCompare(b.countryName)
        );
      }
      return a.countryName.localeCompare(b.countryName);
    });

    return list;
  }, [delegates, searchQuery, sortBy]);

  const handleQuickAdd = async (nameInput?: string, codeInput?: string) => {
    const raw = (nameInput ?? addInput).trim();
    if (!raw) return;
    if (delegates.some((d) => d.countryName.toLowerCase() === raw.toLowerCase())) {
      setAddInput('');
      return;
    }
    const matched = COUNTRIES.find(
      (c) =>
        c.name.toLowerCase() === raw.toLowerCase() || c.code.toLowerCase() === raw.toLowerCase()
    );
    const finalName = matched
      ? matched.name
      : raw.slice(0, BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX);
    const fallbackLetters = (codeInput || raw.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 3).toUpperCase();
    const finalCode = matched
      ? matched.code
      : fallbackLetters.length >= 2
        ? fallbackLetters
        : 'DEL';

    setAddingBusy(true);
    setAddError(null);
    try {
      await onAddDelegate(finalName, finalCode);
      setAddInput('');
      setAddingOpen(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Unable to add delegate.');
    } finally {
      setAddingBusy(false);
    }
  };

  if (collapsed) {
    return (
      <aside className="w-12 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-4 lg:h-full">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Show delegates sidebar"
          className="p-2 rounded-lg text-slate-600 hover:text-[#0047AB] hover:bg-blue-50 transition-colors cursor-pointer"
          title="Show Delegates"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        <span className="mt-4 text-[11px] font-semibold text-slate-400 [writing-mode:vertical-rl] rotate-180 tracking-wide">
          Delegates ({delegates.length})
        </span>
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-[310px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col max-h-[38vh] lg:max-h-none lg:h-full min-h-0 overflow-hidden">
      <div className="p-3 border-b border-slate-200 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-slate-900">
            Delegates ({delegates.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAddError(null);
                setAddingOpen((prev) => !prev);
              }}
              aria-label="Add delegate"
              title="Add delegate"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
            >
              {addingOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>Add</span>
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <span>Hide</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {addingOpen && (
          <div className="p-2.5 bg-slate-50 border border-blue-200 rounded-lg space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                maxLength={BLUEPRINT_BOUNDS.DELEGATE_NAME_MAX}
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (addSuggestions.length > 0 && addInput.trim()) {
                      handleQuickAdd(addSuggestions[0].name, addSuggestions[0].code);
                    } else {
                      handleQuickAdd();
                    }
                  }
                }}
                placeholder="Country or custom role..."
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-[#0047AB]"
              />
              <button
                type="button"
                disabled={addingBusy || !addInput.trim()}
                onClick={() => handleQuickAdd()}
                className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0047AB] hover:bg-[#003580] disabled:opacity-50 rounded-md cursor-pointer shrink-0"
              >
                {addingBusy ? '...' : 'Add'}
              </button>
            </div>
            {addError && (
              <p role="alert" className="text-[11px] font-medium text-red-600 leading-snug">
                {addError}
              </p>
            )}
            {addInput.trim().length > 0 && addSuggestions.length > 0 && (
              <div className="max-h-32 overflow-y-auto bg-white border border-slate-200 rounded-md divide-y divide-slate-100">
                {addSuggestions.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleQuickAdd(c.name, c.code)}
                    className="w-full px-2.5 py-1.5 flex items-center justify-between text-left text-xs hover:bg-blue-50 cursor-pointer"
                  >
                    <span className="flex items-center gap-2 text-slate-800 truncate">
                      <CountryFlag code={c.code} name={c.name} size="sm" />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="font-mono-tabular text-[10px] text-slate-400">{c.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search delegation..."
            className="w-full min-h-10 pl-8 pr-2.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#0047AB]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { key: 'alpha', label: 'A–Z' },
                { key: 'speeches', label: 'Speeches' },
                { key: 'pois', label: 'POIs' },
                { key: 'motions', label: 'Motions' },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSortBy(item.key)}
                className={`flex-1 min-h-9 px-2 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  sortBy === item.key
                    ? 'bg-white text-[#0047AB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {filteredAndSorted.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">
            No delegations match &quot;{searchQuery}&quot;.
          </p>
        ) : (
          filteredAndSorted.map((delegate) => {
            const status = attendance[delegate.id] || 'absent';
            const statusLabel = status === 'pv' ? 'P&V' : status === 'present' ? 'P' : 'A';
            const statusTextClass =
              status === 'pv'
                ? 'text-green-700'
                : status === 'present'
                  ? 'text-sky-700'
                  : 'text-slate-400';

            const totalScore = computeDelegateTotalScore(delegate);
            const speechStyle = getRankHeatColors(delegate.speechesCount, speechValues);
            const poiStyle = getRankHeatColors(delegate.poisCount, poiValues);
            const motionStyle = getRankHeatColors(delegate.motionsProposedCount, motionValues);

            return (
              <div
                key={delegate.id}
                className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <CountryFlag code={delegate.countryCode} name={delegate.countryName} size="sm" />
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {delegate.countryName}
                    </span>
                    <span
                      title="Total participation points (All Speeches + POIs + Motions Proposed + Amendments Proposed)"
                      className="text-xs font-mono-tabular font-bold text-[#0047AB] bg-blue-50 px-1.5 py-0.5 rounded shrink-0"
                    >
                      Pts {totalScore}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      title={
                        status === 'pv'
                          ? 'Present & Voting'
                          : status === 'present'
                            ? 'Present'
                            : 'Absent'
                      }
                      className={`text-sm font-mono-tabular font-bold ${statusTextClass}`}
                    >
                      {statusLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDetails(delegate.id)}
                      className="min-h-9 px-2.5 py-1.5 text-xs font-semibold text-[#0047AB] bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-100 text-center">
                  <div className="py-1 rounded border" style={speechStyle}>
                    <div className="font-mono-tabular text-base font-bold leading-tight">
                      {delegate.speechesCount}
                    </div>
                    <div className="text-[11px] opacity-90">Speeches</div>
                  </div>
                  <div className="py-1 rounded border" style={poiStyle}>
                    <div className="font-mono-tabular text-base font-bold leading-tight">
                      {delegate.poisCount}
                    </div>
                    <div className="text-[11px] opacity-90">POIs</div>
                  </div>
                  <div className="py-1 rounded border" style={motionStyle}>
                    <div className="font-mono-tabular text-base font-bold leading-tight">
                      {delegate.motionsProposedCount}
                    </div>
                    <div className="text-[11px] opacity-90">Motions</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
