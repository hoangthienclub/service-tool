const { spawn, exec } = require('child_process');
const { WebSocketServer } = require('ws');
const wslHelper = require('./wsl-helper');

class ContainerManager {
  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.statsCache = null;
    this.statsCacheTime = 0;
    this.statsCacheDuration = 4000; // 4s cache to keep UI snappy
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  handleWsUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  /**
   * Determine how docker command should be called based on OS & WSL2
   */
  _getDockerRunner() {
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync('where.exe docker.exe', { stdio: 'ignore', timeout: 1000 });
        return { cmd: 'docker.exe', prefixArgs: [] };
      } catch (e) {
        const distro = 'Ubuntu-24.04';
        return { cmd: 'wsl.exe', prefixArgs: ['-d', distro, 'docker'] };
      }
    }
    return { cmd: 'docker', prefixArgs: [] };
  }

  /**
   * Execute docker CLI command and return stdout string
   */
  _execDocker(args, options = {}) {
    return new Promise((resolve, reject) => {
      const { cmd, prefixArgs } = this._getDockerRunner();
      const finalArgs = [...prefixArgs, ...args];
      const timeout = options.timeout || 15000;

      const proc = spawn(cmd, finalArgs, {
        timeout,
        env: { ...process.env, TERM: 'dumb' }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        reject(new Error(`Lỗi khởi tạo Docker CLI: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errMessage = stderr.trim() || stdout.trim() || `Docker thoát với mã lỗi ${code}`;
          reject(new Error(errMessage));
        }
      });
    });
  }

  /**
   * Check if Docker Daemon is running and accessible
   */
  async isDockerAvailable() {
    try {
      const output = await this._execDocker(['info', '--format', '{{.ServerVersion}}'], { timeout: 4000 });
      return { available: true, version: output };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  /**
   * Parse docker port strings into clean structured array
   * e.g. "0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 1110/tcp"
   */
  _parsePorts(portsStr) {
    if (!portsStr || typeof portsStr !== 'string') return [];
    const ports = [];
    const parts = portsStr.split(',').map(s => s.trim()).filter(Boolean);

    for (const part of parts) {
      // Matches "0.0.0.0:5432->5432/tcp" or "[::]:5432->5432/tcp"
      const mappedMatch = part.match(/(?:([0-9a-fA-F:.]+):)?(\d+)->(\d+)(?:\/([a-zA-Z]+))?/);
      if (mappedMatch) {
        const hostIp = mappedMatch[1] || '0.0.0.0';
        const hostPort = parseInt(mappedMatch[2], 10);
        const containerPort = parseInt(mappedMatch[3], 10);
        const type = mappedMatch[4] || 'tcp';

        // Avoid duplicate IPv4 and IPv6 entries for UI clarity
        if (!ports.some(p => p.hostPort === hostPort && p.containerPort === containerPort)) {
          ports.push({ hostIp, hostPort, containerPort, type, display: `${hostPort} ➔ ${containerPort}` });
        }
      } else {
        // Exposed port without host mapping, e.g. "1110/tcp"
        const exposedMatch = part.match(/^(\d+)(?:\/([a-zA-Z]+))?/);
        if (exposedMatch) {
          const containerPort = parseInt(exposedMatch[1], 10);
          const type = exposedMatch[2] || 'tcp';
          ports.push({ hostIp: null, hostPort: null, containerPort, type, display: `${containerPort}/${type}` });
        }
      }
    }
    return ports;
  }

  /**
   * Parse Docker labels into structured object
   */
  _parseLabels(labelsStr) {
    const labels = {};
    if (!labelsStr || typeof labelsStr !== 'string') return labels;
    const items = labelsStr.split(',');
    for (const item of items) {
      const eq = item.indexOf('=');
      if (eq > 0) {
        const k = item.slice(0, eq).trim();
        const v = item.slice(eq + 1).trim();
        labels[k] = v;
      }
    }
    return labels;
  }

  /**
   * Fetch CPU/Memory stats for all running containers
   */
  async getContainerStats(force = false) {
    const now = Date.now();
    if (!force && this.statsCache && (now - this.statsCacheTime < this.statsCacheDuration)) {
      return this.statsCache;
    }

    try {
      const output = await this._execDocker(['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 6000 });
      const statsMap = {};

      if (output) {
        const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const entry = {
              id: (data.ID || '').slice(0, 12),
              name: data.Name,
              cpuPerc: data.CPUPerc || '0%',
              memUsage: data.MemUsage || '0B / 0B',
              memPerc: data.MemPerc || '0%',
              netIO: data.NetIO || '0B / 0B',
              blockIO: data.BlockIO || '0B / 0B',
              pids: data.PIDs || '0'
            };
            if (data.ID) statsMap[data.ID.slice(0, 12)] = entry;
            if (data.Name) statsMap[data.Name] = entry;
          } catch (e) {}
        }
      }

      this.statsCache = statsMap;
      this.statsCacheTime = now;
      return statsMap;
    } catch (err) {
      return this.statsCache || {};
    }
  }

  /**
   * List all containers with merged stats, compose projects, and health status
   */
  async listContainers(all = true) {
    const dockerCheck = await this.isDockerAvailable();
    if (!dockerCheck.available) {
      return {
        success: false,
        error: `Docker không sẵn sàng: ${dockerCheck.error}`,
        isAvailable: false,
        containers: []
      };
    }

    try {
      const args = ['ps', '--format', '{{json .}}'];
      if (all) args.splice(1, 0, '-a');

      const [psOutput, statsMap] = await Promise.all([
        this._execDocker(args),
        this.getContainerStats().catch(() => ({}))
      ]);

      const containers = [];
      if (psOutput) {
        const lines = psOutput.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const raw = JSON.parse(line);
            const shortId = (raw.ID || '').slice(0, 12);
            const name = (raw.Names || '').replace(/^\//, '');
            const labels = this._parseLabels(raw.Labels || '');
            const ports = this._parsePorts(raw.Ports || '');
            const stats = statsMap[shortId] || statsMap[name] || null;

            // Health status: healthy, unhealthy, starting, none
            const healthStatus = (raw.HealthStatus || 'none').toLowerCase();
            const state = (raw.State || 'unknown').toLowerCase(); // running, exited, paused, dead, restarting

            containers.push({
              id: shortId,
              fullId: raw.ID,
              name,
              image: raw.Image,
              command: raw.Command,
              state,
              status: raw.Status,
              healthStatus,
              isRunning: state === 'running',
              isHealthy: healthStatus === 'healthy' || (healthStatus === 'none' && state === 'running'),
              created: raw.CreatedAt,
              runningFor: raw.RunningFor,
              size: raw.Size,
              rawPorts: raw.Ports || '',
              ports,
              networks: raw.Networks || '',
              composeProject: labels['com.docker.compose.project'] || null,
              composeService: labels['com.docker.compose.service'] || null,
              composeConfigFile: labels['com.docker.compose.project.config_files'] || null,
              composeWorkingDir: labels['com.docker.compose.project.working_dir'] || null,
              stats
            });
          } catch (e) {
            console.error('[ContainerManager] Lỗi parse container JSON line:', e);
          }
        }
      }

      // Group containers by Compose Project if applicable
      const projectsMap = {};
      for (const c of containers) {
        const proj = c.composeProject || 'standalone';
        if (!projectsMap[proj]) projectsMap[proj] = [];
        projectsMap[proj].push(c);
      }

      return {
        success: true,
        isAvailable: true,
        dockerVersion: dockerCheck.version,
        containers,
        projects: projectsMap,
        total: containers.length,
        runningCount: containers.filter(c => c.isRunning).length
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        isAvailable: true,
        containers: []
      };
    }
  }

  /**
   * Get detailed inspect data for a container
   */
  async inspectContainer(id) {
    try {
      const output = await this._execDocker(['inspect', id]);
      const parsed = JSON.parse(output);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!data) throw new Error(`Không tìm thấy container ${id}`);

      const state = data.State || {};
      const config = data.Config || {};
      const hostConfig = data.HostConfig || {};
      const networkSettings = data.NetworkSettings || {};

      // Parse environment variables into key-value map
      const envList = config.Env || [];
      const envMap = {};
      for (const item of envList) {
        const eq = item.indexOf('=');
        if (eq > 0) {
          envMap[item.slice(0, eq)] = item.slice(eq + 1);
        }
      }

      // Parse mounts / volumes
      const mounts = (data.Mounts || []).map(m => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
        mode: m.Mode,
        rw: m.RW
      }));

      // Parse IP addresses
      const networks = networkSettings.Networks || {};
      const ipAddresses = Object.entries(networks).map(([netName, net]) => ({
        network: netName,
        ip: net.IPAddress || '',
        gateway: net.Gateway || '',
        mac: net.MacAddress || ''
      }));

      return {
        success: true,
        inspect: {
          id: (data.Id || '').slice(0, 12),
          fullId: data.Id,
          name: (data.Name || '').replace(/^\//, ''),
          created: data.Created,
          image: config.Image,
          state: {
            status: state.Status,
            running: state.Running,
            paused: state.Paused,
            restarting: state.Restarting,
            exitCode: state.ExitCode,
            startedAt: state.StartedAt,
            finishedAt: state.FinishedAt,
            health: state.Health?.Status || 'none'
          },
          env: envMap,
          envArray: envList,
          mounts,
          ipAddresses,
          ports: networkSettings.Ports || {},
          restartPolicy: hostConfig.RestartPolicy?.Name || 'no'
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get recent log lines from container
   */
  async getContainerLogs(id, tail = 200) {
    try {
      const output = await this._execDocker(['logs', '--tail', String(tail), '--timestamps', id], { timeout: 8000 });
      return {
        success: true,
        id,
        logs: output || 'Chưa có dữ liệu logs'
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Start a container
   */
  async startContainer(id) {
    try {
      await this._execDocker(['start', id]);
      return { success: true, id, message: `Container ${id} đã được khởi động` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(id) {
    try {
      await this._execDocker(['stop', '-t', '10', id]);
      return { success: true, id, message: `Container ${id} đã dừng` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Restart a container
   */
  async restartContainer(id) {
    try {
      await this._execDocker(['restart', '-t', '10', id]);
      return { success: true, id, message: `Container ${id} đã khởi động lại` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(id, force = false) {
    try {
      const args = ['rm'];
      if (force) args.push('-f');
      args.push(id);
      await this._execDocker(args);
      return { success: true, id, message: `Container ${id} đã được gỡ bỏ` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Prune stopped containers
   */
  async pruneContainers() {
    try {
      const output = await this._execDocker(['container', 'prune', '-f']);
      return { success: true, output, message: 'Đã dọn dẹp các container đã dừng' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Start all stopped containers
   */
  async startAll() {
    const listRes = await this.listContainers(true);
    if (!listRes.success) return listRes;
    const stopped = listRes.containers.filter(c => !c.isRunning);
    const results = {};
    for (const c of stopped) {
      results[c.id] = await this.startContainer(c.id);
    }
    return { success: true, results, count: stopped.length };
  }

  /**
   * Stop all running containers
   */
  async stopAll() {
    const listRes = await this.listContainers(false);
    if (!listRes.success) return listRes;
    const running = listRes.containers.filter(c => c.isRunning);
    const results = {};
    for (const c of running) {
      results[c.id] = await this.stopContainer(c.id);
    }
    return { success: true, results, count: running.length };
  }

  /**
   * Restart all running containers
   */
  async restartAll() {
    const listRes = await this.listContainers(false);
    if (!listRes.success) return listRes;
    const running = listRes.containers.filter(c => c.isRunning);
    const results = {};
    for (const c of running) {
      results[c.id] = await this.restartContainer(c.id);
    }
    return { success: true, results, count: running.length };
  }

  /**
   * WebSocket Connection for Interactive Web Terminal into Container
   */
  handleConnection(ws, req) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const containerId = parsedUrl.searchParams.get('containerId');
      const requestedShell = parsedUrl.searchParams.get('shell') || 'sh'; // 'sh' or 'bash'

      if (!containerId) {
        ws.send('\r\n\x1b[31m[ERROR] Thiếu tham số containerId!\x1b[0m\r\n');
        ws.close();
        return;
      }

      // Shell resolution logic:
      // If user requested bash, verify if bash exists in the container; if not, notify user and smoothly fallback to sh
      // If user requested sh, directly exec sh.
      let innerCmd;
      if (requestedShell === 'bash') {
        innerCmd = `if command -v bash >/dev/null 2>&1; then exec bash; else printf "\\r\\n\\033[33m[Lưu ý: Container không có /bin/bash, tự động chuyển sang /bin/sh]\\033[0m\\r\\n"; exec sh; fi`;
      } else {
        innerCmd = `exec sh`;
      }

      // Allocate real interactive PTY using `script -qefc "docker exec -it ..."`
      // This enables full interactive support: shell prompt ($ / #), tab-completion, color, and line editing.
      const dockerExecStr = `docker exec -it -e TERM=xterm-256color ${containerId} sh -c '${innerCmd}'`;

      const isWin = process.platform === 'win32';
      let execCmd;
      let execArgs;

      if (!isWin) {
        execCmd = 'script';
        execArgs = ['-qefc', dockerExecStr, '/dev/null'];
      } else {
        try {
          const { execSync } = require('child_process');
          execSync('where.exe docker.exe', { stdio: 'ignore', timeout: 1000 });
          execCmd = 'docker.exe';
          execArgs = ['exec', '-it', '-e', 'TERM=xterm-256color', containerId, 'sh', '-c', innerCmd];
        } catch (e) {
          const distros = wslHelper.getDistros();
          const targetDistro = (distros && distros.find(d => d.isDefault)?.name) || distros[0]?.name || 'Ubuntu-24.04';
          execCmd = 'wsl.exe';
          execArgs = ['-d', targetDistro, 'script', '-qefc', dockerExecStr, '/dev/null'];
        }
      }

      ws.send(`\r\n\x1b[36m➜ Đang mở phiên Interactive Shell (${requestedShell}) trong Container ${containerId}...\x1b[0m\r\n`);

      const proc = spawn(execCmd, execArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'xterm-256color' }
      });

      let isClosed = false;
      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        try { proc.kill('SIGTERM'); } catch (e) {}
        try { if (ws.readyState === ws.OPEN) ws.close(); } catch (e) {}
      };

      proc.stdout.on('data', (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });

      proc.stderr.on('data', (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });

      proc.on('close', (code) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\n\x1b[33m\r\n[Phiên Terminal Container đã kết thúc (Exit code: ${code})]\x1b[0m\r\n`);
        }
        cleanup();
      });

      proc.on('error', (err) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\n\x1b[31m[Exec Error]: ${err.message}\x1b[0m\r\n`);
        }
        cleanup();
      });

      ws.on('message', (msg) => {
        // Filter out JSON control messages like resize if received
        const str = msg.toString();
        try {
          const parsed = JSON.parse(str);
          if (parsed && parsed.type === 'resize') {
            return;
          }
        } catch (e) {}

        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write(msg);
        }
      });

      ws.on('close', cleanup);
      ws.on('error', cleanup);
    } catch (err) {
      try {
        ws.send(`\r\n\x1b[31m[WebSocket Connection Error]: ${err.message}\x1b[0m\r\n`);
        ws.close();
      } catch (e) {}
    }
  }
}

module.exports = new ContainerManager();
