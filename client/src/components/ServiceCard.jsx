import React, { useState } from 'react';
import { Play, Square, RotateCw, Settings, Trash2, ExternalLink } from 'lucide-react';
import TerminalView from './TerminalView';

export default function ServiceCard({
  service,
  logs = [],
  onStart,
  onStop,
  onRestart,
  onClearLogs,
  onOpenEnvModal,
  onChangeProfile,
  onTogglePopout
}) {
  const isRunning = service.statusInfo?.status === 'RUNNING';
  const isError = service.statusInfo?.status === 'ERROR';
  const pid = service.statusInfo?.pid;

  const [isHovered, setIsHovered] = useState(false);

  const profileKeys = Object.keys(service.profiles || {});

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative flex flex-col rounded-xl transition-all duration-200 border bg-[#0b101e] shadow-lg overflow-hidden ${
        isRunning
          ? 'border-emerald-500/60 shadow-emerald-950/20'
          : isError
          ? 'border-rose-500/60 shadow-rose-950/20'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Header of the Card */}
      <div className="p-3.5 pb-2.5 flex flex-col space-y-2.5 bg-[#0e1628]/80 border-b border-darkBorder">
        {/* Row 1: Name, Profile Select, Expand */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <h3 className="font-mono text-sm font-bold text-white tracking-wide">
              {service.name}
            </h3>
            {/* Profile Dropdown */}
            <select
              value={service.activeProfile}
              onChange={(e) => onChangeProfile(service.id, e.target.value)}
              disabled={isRunning}
              className="bg-[#06090e] text-slate-300 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              title={isRunning ? "Hãy Stop service trước khi đổi Profile" : "Chọn Profile Env"}
            >
              {profileKeys.map((k) => (
                <option key={k} value={k}>
                  {k} ({service.profiles[k]?.name || k})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => onOpenEnvModal(service)}
              title="Chỉnh sửa Biến Môi Trường (Env)"
              className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-md transition-colors"
            >
              <Settings size={14} />
            </button>
            <button
              onClick={() => onTogglePopout(service)}
              title="Mở rộng Terminal Log"
              className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-md transition-colors"
            >
              <ExternalLink size={14} />
            </button>
          </div>
        </div>

        {/* Row 2: Badges (Status, Category, Port, PID) */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* Status Badge */}
          {isRunning ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
              Running {pid && `(PID: ${pid})`}
            </span>
          ) : isError ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mr-1.5"></span>
              Error
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold bg-slate-800 text-slate-400 border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 mr-1.5"></span>
              Stopped
            </span>
          )}

          {/* Category/Module Badge */}
          <span className="px-2 py-0.5 rounded font-medium bg-blue-950/60 text-blue-300 border border-blue-800/40">
            {service.category || 'CORE'}
          </span>

          {/* Port Badge */}
          {service.port && (
            <span className="font-mono px-2 py-0.5 rounded font-medium bg-purple-950/60 text-purple-300 border border-purple-800/40">
              :{service.port}
            </span>
          )}

          {/* Active Profile Tag */}
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400">
            {service.activeProfile}
          </span>
        </div>

        {/* Row 3: Action Buttons */}
        <div className="flex items-center space-x-2 pt-1">
          {isRunning ? (
            <button
              onClick={() => onStop(service.id)}
              className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white transition-all shadow-sm"
            >
              <Square size={13} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => onStart(service.id)}
              className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-all shadow-sm shadow-blue-900/30"
            >
              <Play size={13} className="fill-current" />
              <span>Start</span>
            </button>
          )}

          <button
            onClick={() => onRestart(service.id)}
            title="Restart Service"
            className="flex items-center justify-center space-x-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all"
          >
            <RotateCw size={13} />
            <span>Restart</span>
          </button>

          <button
            onClick={() => onClearLogs(service.id)}
            title="Clear Logs"
            className="flex items-center justify-center space-x-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-red-400 transition-all"
          >
            <Trash2 size={13} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Log Area */}
      <div className="p-2 bg-[#06090e]">
        <TerminalView
          logs={logs}
          serviceName={service.name}
          onClear={() => onClearLogs(service.id)}
          onTogglePopout={() => onTogglePopout(service)}
        />
      </div>
    </div>
  );
}
