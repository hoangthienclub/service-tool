import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Play, Square, Layers } from 'lucide-react';
import ServiceCard from './ServiceCard';

export default function GroupSection({
  groupName,
  services = [],
  logsMap = {},
  onStartService,
  onStopService,
  onRestartService,
  onClearLogs,
  onOpenEnvModal,
  onChangeProfile,
  onTogglePopout,
  onStartGroup,
  onStopGroup
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const runningCount = services.filter(s => s.statusInfo?.status === 'RUNNING').length;
  const totalCount = services.length;

  return (
    <div className="mb-8">
      {/* Group Title Bar */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          </button>
          
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg">
              <Layers size={16} />
            </span>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              {groupName}
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {runningCount}/{totalCount} apps running
            </span>
          </div>
        </div>

        {/* Group Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onStartGroup(groupName)}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white border border-slate-700 transition-all"
          >
            <Play size={11} className="fill-current" />
            <span>Start {groupName}</span>
          </button>

          <button
            onClick={() => onStopGroup(groupName)}
            className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800 hover:bg-rose-600 text-slate-400 hover:text-white border border-slate-700 transition-all"
          >
            <Square size={11} />
            <span>Stop {groupName}</span>
          </button>
        </div>
      </div>

      {/* Services Grid */}
      {!isCollapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-5">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              logs={logsMap[service.id] || []}
              onStart={onStartService}
              onStop={onStopService}
              onRestart={onRestartService}
              onClearLogs={onClearLogs}
              onOpenEnvModal={onOpenEnvModal}
              onChangeProfile={onChangeProfile}
              onTogglePopout={onTogglePopout}
            />
          ))}
        </div>
      )}
    </div>
  );
}
