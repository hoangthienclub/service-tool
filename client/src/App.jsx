import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import QuickTasksBar from './components/QuickTasksBar';
import GroupSection from './components/GroupSection';
import EnvModal from './components/EnvModal';
import TerminalView from './components/TerminalView';
import { X } from 'lucide-react';

const CATEGORIES = [
  { id: 'ALL', name: 'ALL' },
  { id: 'ACCOUNTING', name: 'ACCOUNTING' },
  { id: 'COM', name: 'COM' },
  { id: 'NTFC', name: 'NTFC' }
];

export default function App() {
  const [services, setServices] = useState([]);
  const [logsMap, setLogsMap] = useState({});
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Modals state
  const [envModalService, setEnvModalService] = useState(null);
  const [popoutService, setPopoutService] = useState(null);

  // Quick tasks state
  const [currentRunningTask, setCurrentRunningTask] = useState(null);
  const [lastTaskLog, setLastTaskLog] = useState('');

  // Fetch initial services
  const fetchServices = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/services');
      const data = await res.json();
      if (data.success) {
        setServices(data.services);
      }
    } catch (err) {
      console.error('Failed to fetch services:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // SSE Stream connection
  useEffect(() => {
    fetchServices();

    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('initial-state', (e) => {
      const data = JSON.parse(e.data);
      if (data.services) {
        const combined = data.services.map(s => ({
          ...s,
          statusInfo: data.statuses[s.id] || { status: 'STOPPED' }
        }));
        setServices(combined);
      }
    });

    eventSource.addEventListener('status-change', (e) => {
      const data = JSON.parse(e.data);
      setServices((prev) =>
        prev.map((s) =>
          s.id === data.serviceId
            ? { ...s, statusInfo: { ...s.statusInfo, status: data.status, pid: data.pid } }
            : s
        )
      );
    });

    eventSource.addEventListener('service-log', (e) => {
      const data = JSON.parse(e.data);
      setLogsMap((prev) => {
        const current = prev[data.serviceId] || [];
        return {
          ...prev,
          [data.serviceId]: [...current.slice(-1999), data]
        };
      });
    });

    eventSource.addEventListener('log-cleared', (e) => {
      const data = JSON.parse(e.data);
      setLogsMap((prev) => ({
        ...prev,
        [data.serviceId]: []
      }));
    });

    eventSource.addEventListener('task-start', (e) => {
      const data = JSON.parse(e.data);
      setCurrentRunningTask(data.task);
      setLastTaskLog(`Bắt đầu task: ${data.task}`);
    });

    eventSource.addEventListener('task-log', (e) => {
      const data = JSON.parse(e.data);
      setLastTaskLog(data.text);
    });

    eventSource.addEventListener('task-finish', (e) => {
      const data = JSON.parse(e.data);
      setCurrentRunningTask(null);
      setLastTaskLog(data.success ? `✔ Hoàn thành task ${data.task}` : `✖ Thất bại task ${data.task}`);
    });

    eventSource.addEventListener('service-updated', (e) => {
      const updatedSvc = JSON.parse(e.data);
      setServices((prev) =>
        prev.map((s) => (s.id === updatedSvc.id ? { ...s, ...updatedSvc } : s))
      );
    });

    return () => {
      eventSource.close();
    };
  }, [fetchServices]);

  // Actions
  const handleStartService = async (id) => {
    await fetch(`/api/services/${id}/start`, { method: 'POST' });
  };

  const handleStopService = async (id) => {
    await fetch(`/api/services/${id}/stop`, { method: 'POST' });
  };

  const handleRestartService = async (id) => {
    await fetch(`/api/services/${id}/restart`, { method: 'POST' });
  };

  const handleClearLogs = async (id) => {
    await fetch(`/api/services/${id}/clear-logs`, { method: 'POST' });
  };

  const handleChangeProfile = async (id, profile) => {
    await fetch(`/api/services/${id}/active-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile })
    });
  };

  const handleSaveEnvOverrides = async (id, overrides, profileKey) => {
    await fetch(`/api/services/${id}/env-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides, profileKey })
    });
  };

  const handleStartGroup = async (groupName) => {
    await fetch(`/api/groups/${groupName}/start`, { method: 'POST' });
  };

  const handleStopGroup = async (groupName) => {
    await fetch(`/api/groups/${groupName}/stop`, { method: 'POST' });
  };

  const handleStartAll = async () => {
    await fetch('/api/all/start', { method: 'POST' });
  };

  const handleStopAll = async () => {
    await fetch('/api/all/stop', { method: 'POST' });
  };

  const handleRunTask = async (taskType) => {
    await fetch(`/api/tasks/${taskType}`, { method: 'POST' });
  };

  // Filter services by category
  const filteredServices = activeCategory === 'ALL'
    ? services
    : services.filter(s => s.category === activeCategory);

  // Group by group: SERVICE, BFF, FE
  const groups = ['SERVICE', 'BFF', 'FE'];

  return (
    <div className="min-h-screen bg-darkBg text-slate-200 flex flex-col">
      {/* Header */}
      <Header
        categories={CATEGORIES}
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        services={services}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onRefresh={fetchServices}
        isRefreshing={isRefreshing}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-6 py-6">
        {/* Quick Tasks Toolbar */}
        <QuickTasksBar
          onRunTask={handleRunTask}
          currentRunningTask={currentRunningTask}
          lastTaskLog={lastTaskLog}
        />

        {/* Group Sections */}
        {groups.map((group) => {
          const groupServices = filteredServices.filter(s => s.group === group);
          if (groupServices.length === 0) return null;

          return (
            <GroupSection
              key={group}
              groupName={group}
              services={groupServices}
              logsMap={logsMap}
              onStartService={handleStartService}
              onStopService={handleStopService}
              onRestartService={handleRestartService}
              onClearLogs={handleClearLogs}
              onOpenEnvModal={setEnvModalService}
              onChangeProfile={handleChangeProfile}
              onTogglePopout={setPopoutService}
              onStartGroup={handleStartGroup}
              onStopGroup={handleStopGroup}
            />
          );
        })}
      </main>

      {/* Env Settings Modal */}
      <EnvModal
        service={envModalService}
        isOpen={!!envModalService}
        onClose={() => setEnvModalService(null)}
        onSaveOverrides={handleSaveEnvOverrides}
      />

      {/* Fullscreen Popout Terminal Modal */}
      {popoutService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="bg-[#0b101e] border border-slate-700 rounded-xl w-full max-w-5xl h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between px-6 py-3 bg-[#080d1a] border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-bold text-white">
                  Terminal Fullscreen: <span className="text-sky-400">{popoutService.name}</span>
                </span>
                <span className="text-xs text-slate-400 font-mono">({popoutService.activeProfile})</span>
              </div>
              <button
                onClick={() => setPopoutService(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 p-3 bg-[#06090e] overflow-hidden">
              <TerminalView
                logs={logsMap[popoutService.id] || []}
                serviceName={popoutService.name}
                onClear={() => handleClearLogs(popoutService.id)}
                isPopout={true}
                onTogglePopout={() => setPopoutService(null)}
                className="h-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
