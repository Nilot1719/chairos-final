import { Gavel, ArrowRight } from 'lucide-react';

interface LandingViewProps {
  onSignIn: () => void;
  onEnterGuest: () => void;
  loading: boolean;
  error: string | null;
}

export function LandingView({ onSignIn, onEnterGuest, loading, error }: LandingViewProps) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="w-full bg-white border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#0047AB] text-white">
              <Gavel className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              ChairOS
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <span className="whitespace-nowrap">Roll Call</span>
            <span className="whitespace-nowrap">Motions</span>
            <span className="whitespace-nowrap">GSL &amp; Caucuses</span>
            <span className="whitespace-nowrap">Projector Mode</span>
          </nav>
          <button
            type="button"
            onClick={onEnterGuest}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0047AB] hover:bg-[#003580] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Try Guest Mode
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-3xl w-full">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#0047AB] text-white">
                <Gavel className="w-6 h-6" />
              </span>
              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
                ChairOS
              </h1>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 max-w-md"
              >
                {error}
              </div>
            )}

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onEnterGuest}
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 bg-[#0047AB] hover:bg-[#003580] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <span>Continue as Guest</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onSignIn}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2.5 px-5 py-3.5 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-60 text-slate-800 text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>{loading ? 'Connecting...' : 'Sign in with Google'}</span>
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
