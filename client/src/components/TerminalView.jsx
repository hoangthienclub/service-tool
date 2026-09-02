import React, { useEffect, useRef, useState, useMemo } from 'react';
import { AnsiUp } from 'ansi_up';
import { Trash2, Maximize2, Minimize2, ArrowDown } from 'lucide-react';

export default function TerminalView({
  logs = [],
  serviceName,
  onClear,
  isPopout = false,
  onTogglePopout,
  className = ''
}) {
  const terminalEndRef = useRef(null);
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const ansi = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = false;
    return a;
  }, []);

  const renderedLogs = useMemo(() => {
    if (!logs || logs.length === 0) return '';
    return logs
      .map(log => ansi.ansi_to_html(log.text || ''))
      .join('');
  }, [logs, ansi]);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [renderedLogs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className={`relative flex flex-col bg-terminalBg border border-darkBorder rounded-lg overflow-hidden ${className}`}>
      {/* Terminal Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0a0f1d] border-b border-darkBorder text-xs text-slate-400">
        <div className="flex items-center space-x-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-700"></span>
          <span className="font-mono text-slate-300">{serviceName ? `Logs: ${serviceName}` : 'Console Output'}</span>
          <span className="text-[10px] text-slate-500">({logs.length} lines)</span>
        </div>
        <div className="flex items-center space-x-1.5">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              title="Scroll to bottom"
              className="flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
            >
              <ArrowDown size={12} />
              <span>Cuộn xuống</span>
            </button>
          )}
          {onClear && (
            <button
              onClick={onClear}
              title="Xóa logs"
              className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
          {onTogglePopout && (
            <button
              onClick={onTogglePopout}
              title={isPopout ? "Thu nhỏ" : "Phóng to toàn màn hình"}
              className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
            >
              {isPopout ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Terminal Content Body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 p-3 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed select-text whitespace-pre-wrap break-all"
        style={{ minHeight: isPopout ? '70vh' : '220px', maxHeight: isPopout ? '75vh' : '260px' }}
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic py-4 text-center select-none">
            Chưa có log... Hãy bấm Start để khởi động dịch vụ.
          </div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: renderedLogs }} />
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
