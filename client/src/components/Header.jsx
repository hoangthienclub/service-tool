import React from 'react';
import { Play, Square, RotateCw, Activity, Terminal, Layers } from 'lucide-react';

export default function Header({
  categories = [],
  activeCategory,
  onSelectCategory,
  services = [],
  onStartAll,
  onStopAll,
  onRefresh,
  isRefreshing
}) {
  const runningCount = services.filter(s => s.statusInfo?.status === 'RUNNING').length;
  const totalCount = services.length;

  return (
    <header className="sticky top-0 z-40 bg-[#080d1a]/95 backdrop-blur-md border-b border-darkBorder px-6 py-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        
        {/* Left: Branding & Status summary */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30 shadow-sm shadow-blue-500/10">
              <Activity size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-base font-bold text-white tracking-wide">
                  Service Monitor
                </h1>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  Local Dev
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Đang chạy: <span className="text-emerald-400 font-bold font-mono">{runningCount}</span>/{totalCount} services
              </p>
            </div>
          </div>

          {/* Category Filter Tabs */}
          <div className="hidden lg:flex items-center space-x-1 pl-4 border-l border-slate-800">
            {categories.map((cat) => {
              const catServices = cat.id === 'ALL' ? services : services.filter(s => s.category === cat.id);
              const catRunning = catServices.filter(s => s.statusInfo?.status === 'RUNNING').length;
              const isSelected = activeCategory === cat.id;

              return (
                <button
                  key={cat.id}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                      : 'bg-[#0f172a] text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>{cat.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {catRunning}/{catServices.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Global Actions */}
        <div className="flex items-center space-x-2.5 self-end md:self-auto">
          <button
            onClick={onStartAll}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-all shadow-sm shadow-blue-900/30"
          >
            <Play size={13} className="fill-current" />
            <span>Start All</span>
          </button>

          <button
            onClick={onStopAll}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white text-xs font-semibold rounded-lg transition-all"
          >
            <Square size={13} />
            <span>Stop All</span>
          </button>

          <button
            onClick={onRefresh}
            title="Làm mới trạng thái"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
          >
            <RotateCw size={15} className={isRefreshing ? 'animate-spin text-blue-400' : ''} />
          </button>
        </div>

      </div>
    </header>
  );
}
