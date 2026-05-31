import React from 'react'

export default function AdminLockScreen() {
  return (
    <div className="fixed inset-0 z-50 flex h-screen w-full flex-col md:flex-row bg-[#0B0F19] text-slate-100 antialiased">
      
      {/* LEFT PANEL: Enterprise Command Branding (Desktop Only) */}
      <div className="hidden md:flex md:w-3/5 flex-col justify-center items-center p-12 bg-gradient-to-br from-[#0F172A] to-[#0B0F19] border-r border-slate-800/60">
        <div className="max-w-md text-center space-y-6">
          <img 
            src="/logo.png" 
            alt="Iron Eagle Security Logo" 
            className="mx-auto w-56 h-auto object-contain drop-shadow-[0_0_30px_rgba(59,130,246,0.15)]"
          />
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Field Compliance Manager
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
              Platform Administrative Console &middot; Grandmaster Node
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: Secure Interactive Gate */}
      <div className="flex flex-1 flex-col justify-center items-center px-6 py-12 md:px-12 lg:w-2/5 bg-[#0F172A]">
        <div className="w-full max-w-sm space-y-8">
          
          <div className="text-center md:hidden space-y-3 mb-6">
            <img src="/logo.png" alt="Iron Eagle Security" className="mx-auto h-16 w-auto object-contain" />
            <h2 className="text-xl font-bold tracking-tight text-white">Field Compliance Manager</h2>
          </div>

          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Session Locked
            </div>
            <div className="space-y-1.5">
              <h3 className="text-2xl font-bold tracking-tight text-white">Re-Authenticate</h3>
              <p className="text-sm text-slate-400">Your administrative controls require verification to unlock.</p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Superuser Profile</label>
              <div className="flex items-center h-12 px-4 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-sm select-none">
                squires.don@live.com
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Security Password</label>
              </div>
              <input 
                type="password" 
                autoFocus
                placeholder="Enter password to release lock..."
                className="w-full h-12 px-4 rounded-lg bg-slate-900 border border-slate-750 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base"
              />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <button 
                type="submit" 
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg shadow-lg shadow-blue-500/10 transition-colors flex justify-center items-center text-base tracking-wide"
              >
                Release Session Lock
              </button>
            </div>
          </form>

          <footer className="text-center pt-6 border-t border-slate-800/60">
            <p className="text-xs text-slate-500 font-mono tracking-tight">
              CONSOLE CONTEXT: PLATFORM_ADMIN_GATEWAY &middot; v2026.5
            </p>
          </footer>

        </div>
      </div>

    </div>
  )
}
