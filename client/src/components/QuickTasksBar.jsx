import React, { useState } from 'react';
import { Database, GitPullRequest, RefreshCw, PackageCheck, Terminal, CheckCircle2, AlertCircle } from 'lucide-react';

export default function QuickTasksBar({ onRunTask, currentRunningTask, lastTaskLog }) {
  const [showTaskLogs, setShowTaskLogs] = useState(false);

  const tasks = [
    {
      id: 'migrate-all',
      name: 'Run All Migrations',
      icon: Database,
      desc: 'Migrate DB cho acc, com, ntfc',
      color: 'hover:border-amber-500/50 hover:bg-amber-500/10 text-amber-400'
    },
    {
      id: 'sync-all-protos',
      name: 'Sync Protos',
      icon: RefreshCw,
      desc: 'Build & link acc-proto và com-proto',
      color: 'hover:border-purple-500/50 hover:bg-purple-500/10 text-purple-400'
    },
    {
      id: 'git-pull',
      name: 'Git Pull develop',
      icon: GitPullRequest,
      desc: 'Pull code mới nhất từ origin/develop cho toàn bộ repos',
      color: 'hover:border-blue-500/50 hover:bg-blue-500/10 text-blue-400'
    },
    {
      id: 'yarn-install-all',
      name: 'Yarn Install All',
      icon: PackageCheck,
      desc: 'Cài đặt node_modules cho toàn bộ sub-repos',
      color: 'hover:border-emerald-500/50 hover:bg-emerald-500/10 text-emerald-400'
    }
  ];

  return (
    <div className="bg-[#0b101e] border border-slate-800 rounded-xl p-4 mb-6 shadow-md">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        
        <div>
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Terminal size={14} className="text-sky-400" />
            <span>Tác Vụ Tự Động Nhanh (Quick Tasks)</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            Chạy các lệnh phụ trợ 1-click thay vì gõ lệnh terminal thủ công
          </p>
        </div>

        {/* Task Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {tasks.map((task) => {
            const Icon = task.icon;
            const isThisRunning = currentRunningTask === task.id;

            return (
              <button
                key={task.id}
                disabled={!!currentRunningTask}
                onClick={() => onRunTask(task.id)}
                title={task.desc}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-700/80 bg-[#0f172a] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${task.color}`}
              >
                <Icon size={14} className={isThisRunning ? 'animate-spin text-sky-400' : ''} />
                <span>{task.name}</span>
              </button>
            );
          })}
        </div>

      </div>

      {/* Task status indicator if a task is running */}
      {currentRunningTask && (
        <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-sky-400">
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
            <span className="font-semibold">Đang thực thi task: <span className="font-mono text-white">{currentRunningTask}</span></span>
          </div>
          {lastTaskLog && (
            <span className="text-[11px] font-mono text-slate-400 truncate max-w-lg">
              {lastTaskLog}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
