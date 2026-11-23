import * as Flags from 'country-flag-icons/react/3x2';

interface CountryFlagProps {
  code: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const PALETTE_SWATCHES = [
  'bg-blue-900 text-white',
  'bg-sky-700 text-white',
  'bg-indigo-800 text-white',
  'bg-slate-800 text-white',
  'bg-teal-800 text-white',
];

const FLAG_MAP = Flags as Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>>;

export function CountryFlag({ code, name, size = 'md' }: CountryFlagProps) {
  const upper = (code || 'UN').toUpperCase().trim();
  const sizeClass =
    size === 'sm'
      ? 'w-5 h-3.5 text-[9px]'
      : size === 'lg'
        ? 'w-10 h-7 text-xs'
        : 'w-7 h-[19px] text-[10px]';

  const FlagComponent = FLAG_MAP[upper];

  if (FlagComponent) {
    return (
      <FlagComponent
        aria-label={`${name} flag`}
        className={`${sizeClass} shrink-0 rounded-[3px] border border-slate-200 object-cover`}
      />
    );
  }

  const hash = upper.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const swatch = PALETTE_SWATCHES[hash % PALETTE_SWATCHES.length];

  return (
    <span
      aria-label={`${name} code`}
      className={`${sizeClass} ${swatch} inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono-tabular font-semibold tracking-tight`}
    >
      {upper.slice(0, 3)}
    </span>
  );
}
