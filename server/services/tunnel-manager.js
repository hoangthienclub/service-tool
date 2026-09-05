const { spawn, exec } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

let treeKill;
try {
  treeKill = require('tree-kill');
} catch (e) {
  treeKill = (pid, signal, cb) => {
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /F /T /PID ${pid}`, () => cb && cb());
      } else {
        try { process.kill(-pid, signal || 'SIGTERM'); } catch (e) { process.kill(pid, signal || 'SIGTERM'); }
        cb && cb();
      }
    } catch (err) {
      cb && cb(err);
    }
  };
}

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
      path.join(home, '.cargo/bin')
    );
  }

  return paths.filter(Boolean).join(':');
}

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    // tunnelId -> { proc, config, status, pid, error, startedAt }
    this.activeTunnels = new Map();
    // tunnelId -> Array<{ text, timestamp }>
    this.logs = new Map();

    // Ensure all background tunnels are killed when application exits
    const cleanup = () => this.stopAll();
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  /**
   * Check if a local port is already bound by another process
   */
  checkPortInUse(port) {
    return new Promise((resolve) => {
      const numPort = parseInt(port, 10);
      if (!numPort || isNaN(numPort)) {
        return resolve({ inUse: false });
      }

      const tester = net.createServer()
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve({ inUse: true, port: numPort });
          } else {
            resolve({ inUse: false, error: err.message });
          }
        })
        .once('listening', () => {
          tester.close(() => resolve({ inUse: false, port: numPort }));
        })
        .listen(numPort, '127.0.0.1');
    });
  }

  /**
   * Check if a port is actively open and accepting TCP connections (Healthcheck)
   */
  async checkPortListening(port, timeoutMs = 1500) {
    const numPort = parseInt(port, 10);
    if (!numPort) return false;

    // Fast check: PID is listening on port
    const pid = await this.getPortPid(numPort);
    if (pid) {
      return true;
    }

    // Secondary check: Port is bound
    const check = await this.checkPortInUse(numPort);
    if (check.inUse) {
      return true;
    }

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(true);
        }
      });

      socket.on('timeout', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      socket.on('error', () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(false);
        }
      });

      try {
        socket.connect(numPort, '127.0.0.1');
      } catch (e) {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  }

  appendLog(tunnelId, text) {
    if (!this.logs.has(tunnelId)) {
      this.logs.set(tunnelId, []);
    }
    const logList = this.logs.get(tunnelId);
    logList.push({ text, timestamp: Date.now() });
    if (logList.length > 300) {
      logList.shift();
    }
    this.emit('tunnel-log', { tunnelId, id: tunnelId, text, timestamp: Date.now() });
  }

  getLogs(tunnelId) {
    return this.logs.get(tunnelId) || [];
  }

  getStatus(tunnelId) {
    const entry = this.activeTunnels.get(tunnelId);
    if (!entry) {
      return { status: 'STOPPED', pid: null, error: null, startedAt: null };
    }
    return {
      status: entry.status,
      pid: entry.pid,
      error: entry.error,
      startedAt: entry.startedAt
    };
  }

  getAllStatuses() {
    const res = {};
    for (const [id, entry] of this.activeTunnels.entries()) {
      res[id] = {
        status: entry.status,
        pid: entry.pid,
        error: entry.error,
        startedAt: entry.startedAt
      };
    }
    return res;
  }

  /**
   * Find PID of process listening on a port
   */
  async getPortPid(port) {
    const numPort = parseInt(port, 10);
    if (!numPort) return null;
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        const cmd = `netstat -aon | findstr /r /c:":${numPort} *LISTENING"`;
        exec(cmd, (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parseInt(parts[parts.length - 1], 10);
              if (pid) return resolve(pid);
            }
          }
          resolve(null);
        });
      } else {
        const cmd = `lsof -ti:${numPort} -sTCP:LISTEN 2>/dev/null || true`;
        exec(cmd, (err, stdout) => {
          if (err || !stdout) return resolve(null);
          const pid = parseInt(stdout.trim().split('\n')[0], 10);
          resolve(pid || null);
        });
      }
    });
  }

  /**
   * Reconcile tunnel status with active ports / processes
   */
  async syncTunnelStatus(tunnel) {
    if (!tunnel || !tunnel.id || !tunnel.localPort) return;
    const entry = this.activeTunnels.get(tunnel.id);
    if (entry && entry.status === 'CONNECTED') {
      const listening = await this.checkPortListening(tunnel.localPort, 500);
      if (!listening && (!entry.proc || entry.proc.exitCode !== null)) {
        entry.status = 'STOPPED';
        entry.proc = null;
        entry.pid = null;
        this.activeTunnels.delete(tunnel.id);
        this.emit('tunnel-status-changed', {
          tunnelId: tunnel.id,
          id: tunnel.id,
          status: 'STOPPED',
          pid: null,
          error: null
        });
      }
      return;
    }

    const listening = await this.checkPortListening(tunnel.localPort, 500);
    if (listening) {
      const pid = await this.getPortPid(tunnel.localPort);
      this.activeTunnels.set(tunnel.id, {
        proc: null,
        config: tunnel,
        status: 'CONNECTED',
        pid: pid || null,
        error: null,
        startedAt: Date.now()
      });
      this.appendLog(tunnel.id, `\x1b[32m✔ Đã phát hiện tunnel đang hoạt động tại 127.0.0.1:${tunnel.localPort} (PID: ${pid || 'Active'})\x1b[0m\n`);
      this.emit('tunnel-status-changed', {
        tunnelId: tunnel.id,
        id: tunnel.id,
        status: 'CONNECTED',
        pid: pid || null,
        error: null
      });
    }
  }

  /**
   * Sync all tunnels
   */
  async syncAllTunnels(tunnels) {
    if (!Array.isArray(tunnels)) return;
    for (const t of tunnels) {
      await this.syncTunnelStatus(t);
    }
  }

  /**
   * Start a Port Forwarding SSH Tunnel
   */
  async startTunnel(tunnel) {
    const {
      id,
      name,
      localPort,
      remoteHost,
      remotePort,
      sshHost,
      sshPort,
      sshUser,
      sshKeyPath,
      identityFile,
      jumpHost,
      authType,
      password
    } = tunnel;

    if (!id || !localPort || !remotePort || !sshHost) {
      throw new Error('Thiếu thông tin bắt buộc: id, localPort, remotePort, sshHost');
    }

    // If already running
    if (this.activeTunnels.has(id) && this.activeTunnels.get(id).status === 'CONNECTED') {
      return { success: true, status: 'CONNECTED', message: 'Tunnel đang chạy' };
    }

    // Check if localPort is already occupied
    let check = await this.checkPortInUse(localPort);
    if (check.inUse) {
      this.appendLog(id, `\x1b[33m[WARN] Port cục bộ ${localPort} đang bị chiếm dụng. Đang tự động giải phóng port...\x1b[0m\n`);
      await this.killPort(localPort);
      await new Promise(r => setTimeout(r, 600));
      check = await this.checkPortInUse(localPort);
      if (check.inUse) {
        const err = `Port cục bộ ${localPort} đã bị chiếm dụng bởi ứng dụng khác và không thể tự động giải phóng!`;
        this.appendLog(id, `\x1b[31m[ERROR] ${err}\x1b[0m\n`);
        this.activeTunnels.set(id, {
          proc: null,
          config: tunnel,
          status: 'ERROR',
          pid: null,
          error: err,
          startedAt: null
        });
        this.emit('tunnel-status-changed', { tunnelId: id, status: 'ERROR', error: err });
        throw new Error(err);
      } else {
        this.appendLog(id, `\x1b[32m✔ Đã giải phóng port ${localPort} thành công!\x1b[0m\n`);
      }
    }

    const isPasswordAuth = authType === 'password' && Boolean(password);

    this.appendLog(id, `\x1b[36m➜ Khởi tạo tunnel "${name || id}"...\x1b[0m\n`);
    this.appendLog(id, `  Local: 127.0.0.1:${localPort} ➔ Remote: ${remoteHost || '127.0.0.1'}:${remotePort}\n`);
    this.appendLog(id, `  Qua SSH Server: ${sshUser ? sshUser + '@' : ''}${sshHost}:${sshPort || 22}\n`);
    this.appendLog(id, `  Xác thực: ${isPasswordAuth ? 'Mật khẩu (Password)' : 'SSH Private Key'}\n`);

    const args = [
      '-N', // Do not execute a remote command (tunnel only)
      '-L', `${localPort}:${remoteHost || '127.0.0.1'}:${remotePort}`,
      '-p', String(sshPort || 22),
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'TCPKeepAlive=yes'
    ];

    if (isPasswordAuth) {
      args.push('-o', 'PreferredAuthentications=password,keyboard-interactive');
      args.push('-o', 'PubkeyAuthentication=no');
    } else {
      const keyFile = identityFile || sshKeyPath;
      if (keyFile) {
        const resolvedKey = keyFile.replace(/^~/, process.env.HOME || '');
        if (fs.existsSync(resolvedKey)) {
          args.push('-i', resolvedKey);
        } else {
          this.appendLog(id, `\x1b[33m[WARN] Không tìm thấy file key: ${keyFile}\x1b[0m\n`);
        }
      }
    }

    if (jumpHost) {
      args.push('-J', jumpHost);
    }

    args.push(`${sshUser ? sshUser + '@' : ''}${sshHost}`);

    const tunnelEntry = {
      proc: null,
      config: tunnel,
      status: 'CONNECTING',
      pid: null,
      error: null,
      startedAt: Date.now()
    };
    this.activeTunnels.set(id, tunnelEntry);
    this.emit('tunnel-status-changed', {
      tunnelId: id,
      id,
      status: 'CONNECTING',
      pid: null,
      error: null
    });

    const spawnEnv = {
      ...process.env,
      PATH: getEnhancedPath()
    };

    if (isPasswordAuth) {
      const askpassScript = path.join(__dirname, '../scripts/ssh-askpass.sh');
      spawnEnv.SSH_ASKPASS = askpassScript;
      spawnEnv.SSH_ASKPASS_REQUIRE = 'force';
      spawnEnv.DISPLAY = ':0';
      spawnEnv.SM_SSH_PASS = password;
    }

    let proc;
    try {
      proc = spawn('ssh', args, {
        env: spawnEnv,
        detached: false
      });
    } catch (e) {
      tunnelEntry.status = 'ERROR';
      tunnelEntry.error = e.message;
      this.appendLog(id, `\x1b[31m[ERROR] Không thể khởi chạy tiến trình ssh: ${e.message}\x1b[0m\n`);
      this.emit('tunnel-status-changed', {
        tunnelId: id,
        id,
        status: 'ERROR',
        error: e.message,
        lastError: e.message,
        pid: null
      });
      throw e;
    }

    tunnelEntry.proc = proc;
    tunnelEntry.pid = proc.pid;

    proc.stdout.on('data', (d) => {
      this.appendLog(id, d.toString());
    });

    proc.stderr.on('data', (d) => {
      const str = d.toString();
      this.appendLog(id, `\x1b[33m${str}\x1b[0m`);
      if (str.toLowerCase().includes('bind: address already in use') || str.toLowerCase().includes('permission denied (publickey')) {
        tunnelEntry.error = str.trim();
      }
    });

    proc.on('error', (err) => {
      tunnelEntry.status = 'ERROR';
      tunnelEntry.error = err.message;
      this.appendLog(id, `\x1b[31m[PROCESS ERROR] ${err.message}\x1b[0m\n`);
      this.emit('tunnel-status-changed', {
        tunnelId: id,
        id,
        status: 'ERROR',
        error: err.message,
        lastError: err.message,
        pid: null
      });
    });

    proc.on('close', (code, signal) => {
      const status = code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' ? 'STOPPED' : 'ERROR';
      tunnelEntry.status = status;
      tunnelEntry.proc = null;
      tunnelEntry.pid = null;
      if (code !== 0 && code !== null) {
        tunnelEntry.error = tunnelEntry.error || `SSH process kết thúc với mã lỗi ${code}`;
      }
      this.appendLog(id, `\x1b[90m[TUNNEL CLOSED] Process kết thúc (Code: ${code}, Signal: ${signal})\x1b[0m\n`);
      this.emit('tunnel-status-changed', {
        tunnelId: id,
        id,
        status,
        error: tunnelEntry.error,
        lastError: tunnelEntry.error,
        pid: null
      });
      if (status === 'STOPPED') {
        this.activeTunnels.delete(id);
      }
    });

    // Verify tunnel listening within 5 seconds
    let isLive = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (tunnelEntry.status === 'ERROR' || !this.activeTunnels.has(id)) break;
      
      const listening = await this.checkPortListening(localPort, 800);
      if (listening) {
        isLive = true;
        break;
      }
    }

    if (isLive && tunnelEntry.status !== 'ERROR') {
      tunnelEntry.status = 'CONNECTED';
      tunnelEntry.error = null;
      this.appendLog(id, `\x1b[32m✔ Tunnel đã sẵn sàng! Đang lắng nghe tại 127.0.0.1:${localPort}\x1b[0m\n`);
      this.emit('tunnel-status-changed', {
        tunnelId: id,
        id,
        status: 'CONNECTED',
        pid: proc.pid,
        error: null,
        lastError: null
      });
      return { success: true, status: 'CONNECTED', pid: proc.pid };
    } else {
      if (tunnelEntry.status === 'CONNECTING') {
        if (proc.exitCode === null) {
          tunnelEntry.status = 'CONNECTED';
          this.emit('tunnel-status-changed', {
            tunnelId: id,
            id,
            status: 'CONNECTED',
            pid: proc.pid,
            error: null,
            lastError: null
          });
          return { success: true, status: 'CONNECTED', pid: proc.pid };
        }
      }
      return { success: false, status: tunnelEntry.status, error: tunnelEntry.error || 'Timeout kết nối tunnel' };
    }
  }

  /**
   * Stop an active tunnel
   */
  async stopTunnel(tunnelId) {
    const entry = this.activeTunnels.get(tunnelId);
    let localPort = entry?.config?.localPort;
    if (!localPort) {
      try {
        const envManager = require('./env-manager');
        const t = envManager.getTunnels().find(x => x.id === tunnelId);
        if (t) localPort = t.localPort;
      } catch (e) {}
    }

    this.appendLog(tunnelId, `\x1b[33m➜ Đang ngắt kết nối tunnel...\x1b[0m\n`);

    if (entry) {
      entry.status = 'STOPPED';
      if (entry.proc && entry.pid) {
        try {
          treeKill(entry.pid, 'SIGTERM', () => {});
        } catch (e) {
          try { process.kill(entry.pid, 'SIGTERM'); } catch (err) {}
        }
      } else if (entry.pid) {
        try {
          treeKill(entry.pid, 'SIGTERM', () => {});
        } catch (e) {
          try { process.kill(entry.pid, 'SIGTERM'); } catch (err) {}
        }
      }
      entry.proc = null;
      entry.pid = null;
    }

    if (localPort) {
      await this.killPort(localPort);
    }

    this.activeTunnels.delete(tunnelId);
    this.appendLog(tunnelId, `\x1b[32m✔ Đã ngắt kết nối tunnel thành công!\x1b[0m\n`);
    this.emit('tunnel-status-changed', {
      tunnelId,
      id: tunnelId,
      status: 'STOPPED',
      pid: null,
      error: null
    });
    return { success: true, status: 'STOPPED' };
  }

  /**
   * Kill occupying process on a given port
   */
  async killPort(port) {
    if (!port) return;
    const numPort = parseInt(port, 10);
    if (isNaN(numPort) || numPort <= 1024) return;

    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        const cmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr /r /c:":${numPort} *LISTENING"') do taskkill /f /t /pid %a 2>nul`;
        exec(cmd, () => resolve(true));
      } else {
        const cmd = `
          pids=$(lsof -ti:${numPort} 2>/dev/null || fuser ${numPort}/tcp 2>/dev/null || true)
          for pid in $pids; do
            if [ -n "$pid" ] && [ "$pid" != "${process.pid}" ]; then
              kill -9 "$pid" 2>/dev/null || true
            fi
          done
        `;
        exec(cmd, { shell: '/bin/bash' }, () => resolve(true));
      }
    });
  }

  /**
   * Stop all active tunnels
   */
  stopAll() {
    for (const [id, entry] of this.activeTunnels.entries()) {
      if (entry.proc && entry.pid) {
        try {
          treeKill(entry.pid, 'SIGTERM', () => {});
        } catch (e) {
          try { process.kill(entry.pid, 'SIGTERM'); } catch (err) {}
        }
      }
    }
    this.activeTunnels.clear();
  }
}

module.exports = new TunnelManager();
