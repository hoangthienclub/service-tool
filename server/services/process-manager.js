const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let treeKill;
try {
  treeKill = require('tree-kill');
} catch (e) {
  treeKill = (pid, signal, cb) => {
    try {
      if (process.platform === 'win32') {
        require('child_process').exec(`taskkill /F /T /PID ${pid}`, () => cb && cb());
      } else {
        try { process.kill(-pid, signal || 'SIGTERM'); } catch (e) { process.kill(pid, signal || 'SIGTERM'); }
        cb && cb();
      }
    } catch (err) {
      cb && cb(err);
    }
  };
}
const EventEmitter = require('events');
const envManager = require('./env-manager');

function getEnhancedPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const paths = [
    process.env.PATH || '',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];

  if (home) {
    paths.push(
      path.join(home, '.local/bin'),
      path.join(home, '.local/share/pnpm'),
      path.join(home, '.pnpm'),
      path.join(home, '.yarn/bin'),
      path.join(home, '.config/yarn/global/node_modules/.bin'),
      path.join(home, '.bun/bin'),
      path.join(home, '.cargo/bin')
    );

    const nvmVersionsDir = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmVersionsDir)) {
      try {
        const versions = fs.readdirSync(nvmVersionsDir);
        for (const v of versions) {
          paths.push(path.join(nvmVersionsDir, v, 'bin'));
        }
      } catch (e) {}
    }

    paths.push(
      path.join(home, '.fnm/current/bin'),
      path.join(home, '.volta/bin'),
      path.join(home, '.asdf/shims')
    );
  }

  const pathSep = process.platform === 'win32' ? ';' : ':';
  const allParts = paths.join(pathSep).split(pathSep).filter(Boolean);
  return Array.from(new Set(allParts)).join(pathSep);
}

process.env.PATH = getEnhancedPath();

const MAX_LOG_LINES = 2000;

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // serviceId -> { process, pid, status, startedAt, exitCode, manualStopped }
    this.logBuffers = new Map(); // serviceId -> Array<{ text: string, type: 'stdout'|'stderr'|'system', time: string }>
  }

  getLogBuffer(serviceId) {
    if (!this.logBuffers.has(serviceId)) {
      this.logBuffers.set(serviceId, []);
    }
    return this.logBuffers.get(serviceId);
  }

  getAllLogs(maxLinesPerService = 300) {
    const result = {};
    for (const [id, buffer] of this.logBuffers.entries()) {
      result[id] = buffer.slice(-maxLinesPerService);
    }
    return result;
  }

  appendLog(serviceId, text, type = 'stdout') {
    const buffer = this.getLogBuffer(serviceId);
    const logEntry = {
      text,
      type,
      time: new Date().toISOString()
    };
    buffer.push(logEntry);
    if (buffer.length > MAX_LOG_LINES) {
      buffer.shift();
    }
    this.emit('log', { serviceId, ...logEntry });
  }

  clearLogs(serviceId) {
    this.logBuffers.set(serviceId, []);
    this.emit('log-cleared', { serviceId });
  }

  getStatus(serviceId) {
    const procInfo = this.processes.get(serviceId);
    if (!procInfo) {
      return { status: 'STOPPED', pid: null, startedAt: null, exitCode: null };
    }
    return {
      status: procInfo.status,
      pid: procInfo.pid,
      startedAt: procInfo.startedAt,
      exitCode: procInfo.exitCode
    };
  }

  getAllStatuses() {
    const statuses = {};
    const services = envManager.getServices();
    for (const svc of services) {
      statuses[svc.id] = {
        ...this.getStatus(svc.id),
        activeProfile: svc.activeProfile,
        port: svc.port
      };
    }
    return statuses;
  }

  async startService(serviceId) {
    const svc = envManager.getServiceById(serviceId);
    if (!svc) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const current = this.processes.get(serviceId);
    if (current && current.pid && current.status === 'RUNNING') {
      return this.getStatus(serviceId);
    }

    // Set status to STARTING
    this.processes.set(serviceId, {
      process: null,
      pid: null,
      status: 'STARTING',
      startedAt: new Date().toISOString(),
      exitCode: null,
      manualStopped: false
    });
    this.emit('status-change', { serviceId, status: 'STARTING', pid: null });

    this.appendLog(serviceId, `\x1b[36m[Dashboard] Đang chuẩn bị khởi động ${svc.name} (Profile: ${svc.activeProfile})...\x1b[0m\n`, 'system');

    const env = envManager.getEffectiveEnvForService(serviceId);

    // Auto-kill old occupying port before starting to avoid EADDRINUSE
    // Prioritize runtime env.PORT over stale metadata svc.port to never kill another service!
    const portsToKill = new Set();
    const effectivePort = env?.PORT ? parseInt(env.PORT, 10) : (svc.port ? parseInt(svc.port, 10) : null);
    if (effectivePort && !isNaN(effectivePort) && effectivePort > 1024) {
      portsToKill.add(effectivePort);
    }
    if (env?.GRPC_PORT) {
      const grpc = parseInt(env.GRPC_PORT, 10);
      if (!isNaN(grpc) && grpc > 1024) portsToKill.add(grpc);
    }

    for (const p of portsToKill) {
      await this.killPort(p);
    }

    try {
      const baseEnv = { ...process.env };
      delete baseEnv.PORT;

      const spawnEnv = {
        ...baseEnv,
        ...env,
        PATH: getEnhancedPath(),
        FORCE_COLOR: '1'
      };

      if (svc.port && !spawnEnv.PORT) {
        spawnEnv.PORT = String(svc.port);
      }

      let spawnCmd = svc.script;
      let spawnArgs = Array.isArray(svc.args) ? [...svc.args] : (svc.args ? svc.args.split(' ') : []);
      let spawnCwd = svc.cwd;
      let spawnShell = true;

      if (svc.isWsl && process.platform === 'win32') {
        const wslHelper = require('./wsl-helper');
        const distro = svc.wslDistro || 'Ubuntu';
        let rawPath = svc.wslPath || svc.cwd || '~';
        let linuxPath = wslHelper.resolveWindowsPathToWsl(rawPath);
        if (!linuxPath || linuxPath === '.') linuxPath = '~';

        const envExports = Object.entries(spawnEnv)
          .filter(([k]) => !['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PSMODULEPATH'].includes(k.toUpperCase()))
          .map(([k, v]) => `export ${k}=${JSON.stringify(String(v))}`)
          .join('; ');

        const runCmd = `${svc.script} ${Array.isArray(svc.args) ? svc.args.join(' ') : (svc.args || '')}`;
        // Fallback PATH for node/nvm/pnpm/yarn in case .bashrc returns early on non-interactive
        const envInit = `export PATH=$PATH:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$HOME/.local/share/pnpm:$HOME/.yarn/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin`;
        const fullBashScript = [envInit, envExports, runCmd].filter(Boolean).join('; ');

        spawnCmd = 'wsl.exe';
        spawnArgs = ['-d', distro, '--cd', linuxPath, 'bash', '-l', '-c', fullBashScript];
        spawnCwd = undefined;
        spawnShell = false;
        this.appendLog(serviceId, `\x1b[35m[WSL2] Khởi chạy trong Distro ${distro} tại ${linuxPath} (Login Shell)\x1b[0m\n`, 'system');
      }

      const child = spawn(spawnCmd, spawnArgs, {
        cwd: spawnCwd,
        env: spawnEnv,
        shell: spawnShell,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.appendLog(serviceId, `\x1b[32m[Dashboard] Đang thực thi: ${spawnCmd} ${Array.isArray(spawnArgs) ? spawnArgs.join(' ') : spawnArgs} (PID: ${child.pid})\x1b[0m\n`, 'system');

      const procInfo = {
        process: child,
        pid: child.pid,
        status: 'STARTING',
        startedAt: new Date().toISOString(),
        exitCode: null,
        manualStopped: false
      };

      this.processes.set(serviceId, procInfo);
      this.emit('status-change', { serviceId, status: 'STARTING', pid: child.pid });

      let startupTimer = setTimeout(() => {
        if (procInfo.status === 'STARTING' && procInfo.pid && !procInfo.manualStopped) {
          procInfo.status = 'RUNNING';
          this.emit('status-change', { serviceId, status: 'RUNNING', pid: child.pid });
        }
      }, 4000);

      const checkLogForStatus = (rawText) => {
        const text = rawText.toString();
        // Check for compile errors / crash in watch mode
        const hasCompileErrors = /Found\s+[1-9]\d*\s+errors?/i.test(text) || 
                                 /error\s+TS\d+:/i.test(text) ||
                                 /Failed to compile/i.test(text) ||
                                 /EADDRINUSE/i.test(text) ||
                                 /UnhandledPromiseRejection/i.test(text) ||
                                 /Cannot find module/i.test(text);

        // Check for successful startup / compilation
        const hasSuccess = /Found\s+0\s+errors/i.test(text) ||
                           /Nest application successfully started/i.test(text) ||
                           /NestFactory/i.test(text) ||
                           /Application is running on/i.test(text) ||
                           /compiled successfully/i.test(text) ||
                           /VITE\s+v\d+/i.test(text) ||
                           /ready in\s+\d+/i.test(text) ||
                           /Local:\s+http/i.test(text) ||
                           /Network:\s+http/i.test(text) ||
                           /Listening on port/i.test(text) ||
                           /Server running at/i.test(text) ||
                           /listening at/i.test(text) ||
                           /Consumer started/i.test(text) ||
                           /Socket server started/i.test(text);

        if (hasCompileErrors && procInfo.status !== 'STOPPED' && !procInfo.manualStopped) {
          if (startupTimer) clearTimeout(startupTimer);
          procInfo.status = 'ERROR';
          this.emit('status-change', { serviceId, status: 'ERROR', pid: child.pid, error: 'Compile / Runtime error' });
        } else if (hasSuccess && procInfo.status !== 'STOPPED' && !procInfo.manualStopped) {
          if (startupTimer) clearTimeout(startupTimer);
          if (procInfo.status !== 'RUNNING') {
            procInfo.status = 'RUNNING';
            this.emit('status-change', { serviceId, status: 'RUNNING', pid: child.pid });
          }
        }
      };

      child.stdout.on('data', (data) => {
        const text = data.toString();
        this.appendLog(serviceId, text, 'stdout');
        checkLogForStatus(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        this.appendLog(serviceId, text, 'stderr');
        checkLogForStatus(text);
      });

      child.on('error', (err) => {
        if (startupTimer) clearTimeout(startupTimer);
        this.appendLog(serviceId, `\x1b[31m[Dashboard Error] ${err.message}\x1b[0m\n`, 'stderr');
        procInfo.status = 'ERROR';
        this.emit('status-change', { serviceId, status: 'ERROR', error: err.message });
      });

      child.on('exit', (code, signal) => {
        if (startupTimer) clearTimeout(startupTimer);
        const wasManual = procInfo.manualStopped;
        const newStatus = wasManual || code === 0 ? 'STOPPED' : 'ERROR';
        procInfo.status = newStatus;
        procInfo.exitCode = code;
        procInfo.pid = null;

        if (code !== 0 && !wasManual) {
          this.appendLog(serviceId, `\x1b[31m[Dashboard] Tiến trình bị lỗi thoát (Exit code: ${code}, Signal: ${signal || 'none'})\x1b[0m\n`, 'stderr');
        } else {
          this.appendLog(serviceId, `\x1b[33m[Dashboard] Tiến trình đã dừng (Exit code: ${code})\x1b[0m\n`, 'system');
        }

        this.emit('status-change', { serviceId, status: newStatus, exitCode: code });
      });

      return this.getStatus(serviceId);
    } catch (err) {
      this.processes.set(serviceId, { process: null, pid: null, status: 'ERROR', startedAt: null, exitCode: 1 });
      this.emit('status-change', { serviceId, status: 'ERROR', error: err.message });
      this.appendLog(serviceId, `\x1b[31m[Dashboard Spawn Error] ${err.message}\x1b[0m\n`, 'stderr');
      throw err;
    }
  }

  async stopService(serviceId) {
    const procInfo = this.processes.get(serviceId);
    if (!procInfo || !procInfo.pid || procInfo.status === 'STOPPED') {
      this.processes.set(serviceId, { process: null, pid: null, status: 'STOPPED' });
      this.emit('status-change', { serviceId, status: 'STOPPED' });
      return { status: 'STOPPED', pid: null };
    }

    procInfo.manualStopped = true;
    procInfo.status = 'STOPPING';
    this.emit('status-change', { serviceId, status: 'STOPPING', pid: procInfo.pid });

    const pid = procInfo.pid;
    this.appendLog(serviceId, `\x1b[33m[Dashboard] Đang dừng tiến trình PID ${pid}...\x1b[0m\n`, 'system');

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        procInfo.status = 'STOPPED';
        procInfo.pid = null;
        procInfo.process = null;
        this.emit('status-change', { serviceId, status: 'STOPPED' });
        resolve({ status: 'STOPPED' });
      };

      // Safety timeout: force kill after 1200ms
      const timeout = setTimeout(() => {
        try {
          treeKill(pid, 'SIGKILL', () => {});
        } catch (e) {}
        finish();
      }, 1200);

      treeKill(pid, 'SIGTERM', (err) => {
        clearTimeout(timeout);
        if (err) {
          treeKill(pid, 'SIGKILL', () => finish());
        } else {
          finish();
        }
      });
    });
  }

  async restartService(serviceId) {
    const procInfo = this.processes.get(serviceId);
    if (procInfo) {
      procInfo.status = 'RESTARTING';
      this.emit('status-change', { serviceId, status: 'RESTARTING' });
    }
    this.appendLog(serviceId, `\x1b[35m[Dashboard] ↺ Đang khởi động lại dịch vụ...\x1b[0m\n`, 'system');
    await this.stopService(serviceId);
    await new Promise(r => setTimeout(r, 600));
    return this.startService(serviceId);
  }

  async startGroup(groupName) {
    const services = envManager.getServices().filter(s => (s.group || s.category || '').toUpperCase() === groupName.toUpperCase());
    const results = {};
    for (const svc of services) {
      try {
        results[svc.id] = await this.startService(svc.id);
      } catch (e) {
        results[svc.id] = { status: 'ERROR', error: e.message };
      }
    }
    return results;
  }

  async stopGroup(groupName) {
    const services = envManager.getServices().filter(s => (s.group || s.category || '').toUpperCase() === groupName.toUpperCase());
    const results = {};
    await Promise.allSettled(services.map(async (svc) => {
      try {
        results[svc.id] = await this.stopService(svc.id);
      } catch (e) {
        results[svc.id] = { status: 'STOPPED', error: e.message };
      }
    }));
    return results;
  }

  async startAll() {
    const services = envManager.getServices();
    const results = {};
    for (const svc of services) {
      try {
        results[svc.id] = await this.startService(svc.id);
      } catch (e) {
        results[svc.id] = { status: 'ERROR', error: e.message };
      }
    }
    return results;
  }

  async stopAll() {
    const services = envManager.getServices();
    const results = {};
    await Promise.allSettled(services.map(async (svc) => {
      try {
        results[svc.id] = await this.stopService(svc.id);
      } catch (e) {
        results[svc.id] = { status: 'STOPPED', error: e.message };
      }
    }));
    return results;
  }

  async restartAll() {
    await this.stopAll();
    await new Promise(r => setTimeout(r, 800));
    return this.startAll();
  }

  async restartGroup(groupName) {
    await this.stopGroup(groupName);
    await new Promise(r => setTimeout(r, 800));
    return this.startGroup(groupName);
  }

  // ================= KILL PORT METHODS =================
  async killPort(port) {
    if (!port) return;
    const numPort = parseInt(port, 10);
    if (isNaN(numPort) || numPort <= 1024) return;

    const myPid = process.pid;
    const currentServerPort = parseInt(process.env.PORT || '48899', 10);
    if (numPort === currentServerPort) return;

    return new Promise((resolve) => {
      const exec = require('child_process').exec;
      if (process.platform === 'win32') {
        const cmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr /r /c:":${numPort} *LISTENING"') do if not "%a"=="${myPid}" taskkill /f /t /pid %a 2>nul`;
        exec(cmd, () => resolve(true));
      } else {
        const cmd = `
          pids=$(lsof -ti:${numPort} 2>/dev/null || fuser ${numPort}/tcp 2>/dev/null || true)
          for pid in $pids; do
            if [ -n "$pid" ] && [ "$pid" != "${myPid}" ]; then
              kill -9 "$pid" 2>/dev/null || true
            fi
          done
        `;
        exec(cmd, { shell: '/bin/bash' }, () => resolve(true));
      }
    });
  }

  async killServicePort(serviceId) {
    const svc = envManager.getServiceById(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    // First stop service gracefully if tracked
    await this.stopService(serviceId);

    const portsToKill = new Set();
    if (svc.port) portsToKill.add(svc.port);

    const env = svc.computedEnv || envManager.getEffectiveEnvForService(serviceId) || {};
    const portKeys = [
      'PORT', 'NEST_API_PORT', 'NEST_SOCKET_PORT', 'HTTP_PORT',
      'SERVER_PORT', 'APP_PORT', 'VITE_PORT', 'PORT_HTTP', 'GRPC_PORT', 'WS_PORT', 'API_PORT'
    ];
    for (const k of portKeys) {
      if (env[k]) {
        const p = parseInt(env[k], 10);
        if (!isNaN(p) && p > 1024) portsToKill.add(p);
      }
    }

    for (const p of portsToKill) {
      await this.killPort(p);
    }

    const portList = Array.from(portsToKill).join(', ');
    if (portsToKill.size > 0) {
      this.appendLog(serviceId, `\x1b[33m[Dashboard] ⚡ Đã giải phóng (kill) toàn bộ tiến trình chiếm dụng port: ${portList}\x1b[0m\n`, 'system');
    } else {
      this.appendLog(serviceId, `\x1b[33m[Dashboard] ⚡ Đã dừng tiến trình dịch vụ\x1b[0m\n`, 'system');
    }
    
    return {
      success: true,
      serviceId,
      killedPorts: Array.from(portsToKill)
    };
  }

  async killAllPorts() {
    const services = envManager.getServices();
    const allPorts = new Set();
    const portKeys = [
      'PORT', 'NEST_API_PORT', 'NEST_SOCKET_PORT', 'HTTP_PORT',
      'SERVER_PORT', 'APP_PORT', 'VITE_PORT', 'PORT_HTTP', 'GRPC_PORT', 'WS_PORT', 'API_PORT'
    ];

    for (const svc of services) {
      if (svc.port) allPorts.add(svc.port);
      const env = svc.computedEnv || envManager.getEffectiveEnvForService(svc.id) || {};
      for (const k of portKeys) {
        if (env[k]) {
          const p = parseInt(env[k], 10);
          if (!isNaN(p) && p > 1024) allPorts.add(p);
        }
      }
    }

    await this.stopAll();

    for (const p of allPorts) {
      await this.killPort(p);
    }

    for (const svc of services) {
      this.appendLog(svc.id, `\x1b[33m[Dashboard] ⚡ Đã giải phóng (kill) port toàn hệ thống!\x1b[0m\n`, 'system');
    }

    return {
      success: true,
      killedPorts: Array.from(allPorts)
    };
  }
}

module.exports = new ProcessManager();
