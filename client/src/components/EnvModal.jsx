import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2, CheckCircle, Sliders } from 'lucide-react';

export default function EnvModal({ service, isOpen, onClose, onSaveOverrides }) {
  if (!isOpen || !service) return null;

  const [envPairs, setEnvPairs] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (service && service.computedEnv) {
      const pairs = Object.entries(service.computedEnv).map(([key, value]) => ({
        key,
        value: String(value)
      }));
      setEnvPairs(pairs);
    }
  }, [service]);

  const handleValueChange = (index, val) => {
    const updated = [...envPairs];
    updated[index].value = val;
    setEnvPairs(updated);
  };

  const handleAddPair = () => {
    if (!newKey.trim()) return;
    setEnvPairs([...envPairs, { key: newKey.trim().toUpperCase(), value: newValue }]);
    setNewKey('');
    setNewValue('');
  };

  const handleDeletePair = (index) => {
    const updated = envPairs.filter((_, i) => i !== index);
    setEnvPairs(updated);
  };

  const handleSave = async () => {
    const overrides = {};
    for (const item of envPairs) {
      overrides[item.key] = item.value;
    }
    await onSaveOverrides(service.id, overrides);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-[#0f172a] border border-slate-700 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-150">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#090d16]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
              <Sliders size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Cấu hình Biến Môi Trường: <span className="font-mono text-sky-400">{service.name}</span>
              </h3>
              <p className="text-xs text-slate-400">
                Profile đang chọn: <span className="text-emerald-400 font-semibold">{service.activeProfile}</span> — Các giá trị dưới đây sẽ được nạp khi khởi chạy service.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content - Env list */}
        <div className="p-6 flex-1 overflow-y-auto space-y-3">
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-400 px-2 uppercase tracking-wider">
            <div className="col-span-5">Key / Variable</div>
            <div className="col-span-6">Value</div>
            <div className="col-span-1 text-center">Xóa</div>
          </div>

          <div className="space-y-2">
            {envPairs.map((pair, index) => (
              <div key={pair.key + index} className="grid grid-cols-12 gap-2 items-center bg-[#090d16]/60 p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors">
                <div className="col-span-5 font-mono text-xs text-sky-300 font-medium px-2 truncate" title={pair.key}>
                  {pair.key}
                </div>
                <div className="col-span-6">
                  <input
                    type="text"
                    value={pair.value}
                    onChange={(e) => handleValueChange(index, e.target.value)}
                    className="w-full bg-[#030712] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  <button
                    onClick={() => handleDeletePair(index)}
                    className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add new Env key-value */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <h4 className="text-xs font-bold text-slate-300 mb-2">Thêm biến mới:</h4>
            <div className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-5">
                <input
                  type="text"
                  placeholder="ENV_KEY_NAME"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full bg-[#030712] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono uppercase focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="col-span-5">
                <input
                  type="text"
                  placeholder="value..."
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full bg-[#030712] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="col-span-2">
                <button
                  type="button"
                  onClick={handleAddPair}
                  className="w-full flex items-center justify-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded transition-colors"
                >
                  <Plus size={14} />
                  <span>Thêm</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#090d16] border-t border-slate-800">
          <span className="text-xs text-slate-500">
            * Các thay đổi sẽ được lưu vào cấu hình cá nhân và tự động áp dụng khi khởi động service.
          </span>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={handleSave}
              className={`flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors ${
                savedSuccess ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              {savedSuccess ? (
                <>
                  <CheckCircle size={14} />
                  <span>Đã lưu!</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Lưu Cấu Hình</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
