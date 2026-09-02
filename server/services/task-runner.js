const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
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

class TaskRunner extends EventEmitter {
  constructor() {
    super();
    this.currentTask = null;
  }

  isBusy() {
    return this.currentTask !== null;
  }

  getUniqueRepos() {
    const services = envManager.getServices();
    const repoMap = new Map();
    for (const s of services) {
      if (s.cwd && fs.existsSync(s.cwd)) {
        if (!repoMap.has(s.cwd)) {
          repoMap.set(s.cwd, {
            dir: s.cwd,
            name: path.basename(s.cwd),
            script: s.script,
            services: [s.name]
          });
        } else {
          repoMap.get(s.cwd).services.push(s.name);
        }
      }
    }
    return Array.from(repoMap.values());
  }

  detectPackageManager(repoDir, defaultScript = 'pnpm') {
    if (fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(repoDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(repoDir, 'package-lock.json'))) return 'npm';
    if (defaultScript && ['pnpm', 'yarn', 'npm', 'bun'].includes(defaultScript)) return defaultScript;
    return 'pnpm';
  }

  runCommand(name, command, args, cwd, customEnv = {}) {
    return new Promise((resolve, reject) => {
      this.emit('task-log', { task: name, text: `\x1b[35m➜ [${name}] Bắt đầu: ${command} ${args.join(' ')} (tại ${cwd})\x1b[0m\n` });

      const envVars = {
        ...process.env,
        PATH: getEnhancedPath(),
        FORCE_COLOR: '1',
        ...customEnv
      };

      const child = spawn(command, args, {
        cwd,
        env: envVars,
        shell: true
      });

      child.stdout.on('data', (d) => {
        this.emit('task-log', { task: name, text: d.toString() });
      });

      child.stderr.on('data', (d) => {
        this.emit('task-log', { task: name, text: d.toString() });
      });

      child.on('error', (err) => {
        this.emit('task-log', { task: name, text: `\x1b[31m[Lỗi] ${err.message}\x1b[0m\n` });
        reject(err);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          this.emit('task-log', { task: name, text: `\x1b[32m✔ [${name}] Hoàn thành thành công!\x1b[0m\n` });
          resolve(true);
        } else {
          this.emit('task-log', { task: name, text: `\x1b[31m✖ [${name}] Thất bại với mã thoát: ${code}\x1b[0m\n` });
          reject(new Error(`Command failed with code ${code}`));
        }
      });
    });
  }

  async runTask(taskType) {
    if (this.isBusy()) {
      throw new Error(`Đang có task '${this.currentTask}' đang chạy. Vui lòng đợi!`);
    }

    this.currentTask = taskType;
    this.emit('task-start', { task: taskType });

    try {
      if (taskType === 'sync-code' || taskType === 'sync-develop' || taskType === 'git-pull') {
        const repos = this.getUniqueRepos();
        if (repos.length === 0) {
          this.emit('task-log', { task: taskType, text: `\x1b[33m[Cảnh báo] Không tìm thấy thư mục repository nào!\x1b[0m\n` });
        }
        let idx = 1;
        for (const repo of repos) {
          this.emit('task-log', { task: taskType, text: `\x1b[36m[${idx}/${repos.length}] ⬇️ Đang kéo code repo: ${repo.name}...\x1b[0m\n` });
          let currentBranch = 'develop';
          try {
            const branchOut = require('child_process').execSync('git branch --show-current', { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, PATH: getEnhancedPath() } }).trim();
            if (branchOut) currentBranch = branchOut;
          } catch (e) {}

          try {
            await this.runCommand(`Git Pull: ${repo.name} (${currentBranch})`, 'git', ['pull', 'origin', currentBranch], repo.dir);
          } catch (err) {
            this.emit('task-log', { task: taskType, text: `\x1b[33m⚠ [${repo.name}] Lỗi pull: ${err.message}. Tiếp tục repo kế tiếp...\x1b[0m\n` });
          }
          idx++;
        }
      } else if (taskType === 'install-dependencies' || taskType === 'install-all' || taskType === 'yarn-install-all') {
        const repos = this.getUniqueRepos();
        if (repos.length === 0) {
          this.emit('task-log', { task: taskType, text: `\x1b[33m[Cảnh báo] Không tìm thấy thư mục repository nào!\x1b[0m\n` });
        }
        let idx = 1;
        for (const repo of repos) {
          const pm = this.detectPackageManager(repo.dir, repo.script);
          this.emit('task-log', { task: taskType, text: `\x1b[36m[${idx}/${repos.length}] 📦 Đang cài dependencies cho: ${repo.name} bằng [${pm}]...\x1b[0m\n` });
          try {
            await this.runCommand(`Install (${pm}): ${repo.name}`, pm, ['install'], repo.dir);
          } catch (err) {
            this.emit('task-log', { task: taskType, text: `\x1b[33m⚠ [${repo.name}] Lỗi cài đặt: ${err.message}. Tiếp tục repo kế tiếp...\x1b[0m\n` });
          }
          idx++;
        }
      } else if (taskType === 'clean-cache' || taskType === 'clean-all') {
        const repos = this.getUniqueRepos();
        let idx = 1;
        for (const repo of repos) {
          this.emit('task-log', { task: taskType, text: `\x1b[36m[${idx}/${repos.length}] 🧹 Đang dọn dẹp cache cho: ${repo.name}...\x1b[0m\n` });
          const targetDirs = [
            path.join(repo.dir, 'dist'),
            path.join(repo.dir, 'node_modules/.cache'),
            path.join(repo.dir, 'node_modules/.vite'),
            path.join(repo.dir, '.turbo')
          ];
          for (const target of targetDirs) {
            if (fs.existsSync(target)) {
              try {
                fs.rmSync(target, { recursive: true, force: true });
                this.emit('task-log', { task: taskType, text: `   ✔ Đã xóa: ${path.relative(repo.dir, target)}\n` });
              } catch (e) {
                this.emit('task-log', { task: taskType, text: `   ⚠ Không thể xóa ${path.basename(target)}: ${e.message}\n` });
              }
            }
          }
          idx++;
        }
        this.emit('task-log', { task: taskType, text: `\x1b[32m✔ Dọn dẹp cache & build artifacts thành công!\x1b[0m\n` });
      } else {
        throw new Error(`Unknown task type: ${taskType}`);
      }

      this.emit('task-finish', { task: taskType, success: true });
      return { success: true };
    } catch (err) {
      this.emit('task-finish', { task: taskType, success: false, error: err.message });
      throw err;
    } finally {
      this.currentTask = null;
    }
  }

  async runServiceTask(serviceId, taskType) {
    if (this.isBusy()) {
      throw new Error(`Đang có task '${this.currentTask}' đang chạy. Vui lòng đợi!`);
    }

    const svc = envManager.getServiceById(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    const taskName = `${taskType}:${svc.name}`;
    this.currentTask = taskName;
    this.emit('task-start', { task: taskName });

    try {
      if (taskType === 'pull') {
        let currentBranch = 'develop';
        try {
          const branchOut = require('child_process').execSync('git branch --show-current', { cwd: svc.cwd, encoding: 'utf8', env: { ...process.env, PATH: getEnhancedPath() } }).trim();
          if (branchOut) currentBranch = branchOut;
        } catch (e) {}
        await this.runCommand(`Pull: ${svc.name} (${currentBranch})`, 'git', ['pull', 'origin', currentBranch], svc.cwd);
      } else if (taskType === 'install') {
        const pm = this.detectPackageManager(svc.cwd, svc.script);
        await this.runCommand(`Install: ${svc.name} (${pm})`, pm, ['install'], svc.cwd);
      } else if (taskType === 'clean') {
        const targetDirs = [
          path.join(svc.cwd, 'dist'),
          path.join(svc.cwd, 'node_modules/.cache'),
          path.join(svc.cwd, 'node_modules/.vite'),
          path.join(svc.cwd, '.turbo')
        ];
        for (const target of targetDirs) {
          if (fs.existsSync(target)) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
              this.emit('task-log', { task: taskName, text: `✔ Đã xóa: ${path.relative(svc.cwd, target)}\n` });
            } catch (e) {}
          }
        }
      } else if (taskType === 'migrate' && svc.migrationCmd) {
        const env = envManager.getEffectiveEnvForService(serviceId);
        const [cmd, ...args] = svc.migrationCmd.split(' ');
        await this.runCommand(`Migrate: ${svc.name}`, cmd, args, svc.cwd, env);
      } else {
        throw new Error(`Unsupported service task: ${taskType}`);
      }

      this.emit('task-finish', { task: taskName, success: true });
      return { success: true };
    } catch (err) {
      this.emit('task-finish', { task: taskName, success: false, error: err.message });
      throw err;
    } finally {
      this.currentTask = null;
    }
  }

  async runCustomScript(serviceId, scriptConfig) {
    if (this.isBusy()) {
      throw new Error(`Đang có task '${this.currentTask}' đang chạy. Vui lòng đợi!`);
    }

    const svc = envManager.getServiceById(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    const scriptName = scriptConfig.name || scriptConfig.command || 'Custom Script';
    const taskName = `${scriptName} (${svc.name})`;
    this.currentTask = taskName;
    this.emit('task-start', { task: taskName });

    const targetCwd = scriptConfig.cwd || svc.cwd;
    const commandToRun = (scriptConfig.command || '').trim();
    if (!commandToRun) throw new Error('Command is required');

    const env = envManager.getEffectiveEnvForService(serviceId);

    try {
      this.emit('task-log', { task: taskName, text: `\x1b[36m[Dashboard] ⚡ Bắt đầu chạy script: "${commandToRun}" tại ${targetCwd}...\x1b[0m\n` });
      const [cmd, ...args] = commandToRun.split(' ');
      await this.runCommand(taskName, cmd, args, targetCwd, env);
      this.emit('task-finish', { task: taskName, success: true });
      return { success: true, task: taskName };
    } catch (err) {
      this.emit('task-finish', { task: taskName, success: false, error: err.message });
      throw err;
    } finally {
      this.currentTask = null;
    }
  }

  async runGlobalScript(scriptConfig) {
    if (this.isBusy()) {
      throw new Error(`Đang có task '${this.currentTask}' đang chạy. Vui lòng đợi!`);
    }

    const scriptName = scriptConfig.name || scriptConfig.command || 'Custom Script';
    const taskName = `${scriptName}`;
    this.currentTask = taskName;
    this.emit('task-start', { task: taskName });

    const targetCwd = scriptConfig.cwd || envManager.userConfig.workspaceRoot || ROOT_DIR;
    const commandToRun = (scriptConfig.command || '').trim();
    if (!commandToRun) throw new Error('Command is required');

    try {
      const effectiveEnvInfo = envManager.getEffectiveEnvForScript(scriptConfig);
      const combinedEnv = { ...process.env, ...effectiveEnvInfo.env };
      // Delete dashboard server port so it does not interfere
      if (!effectiveEnvInfo.env.PORT && !scriptConfig.envOverrides?.PORT) {
        delete combinedEnv.PORT;
      }

      this.emit('task-log', { task: taskName, text: `\x1b[36m[Dashboard] ⚡ Bắt đầu chạy script: "${commandToRun}" tại ${targetCwd}...\x1b[0m\n` });
      this.emit('task-log', { task: taskName, text: `\x1b[32m[Dashboard] 🌿 Đã nạp ${effectiveEnvInfo.count} biến môi trường (Nguồn: ${effectiveEnvInfo.sourceDesc}${effectiveEnvInfo.overrideCount > 0 ? `, +${effectiveEnvInfo.overrideCount} tùy chỉnh` : ''})\x1b[0m\n` });

      const [cmd, ...args] = commandToRun.split(' ');
      await this.runCommand(taskName, cmd, args, targetCwd, combinedEnv);
      this.emit('task-finish', { task: taskName, success: true });
      return { success: true, task: taskName };
    } catch (err) {
      this.emit('task-finish', { task: taskName, success: false, error: err.message });
      throw err;
    } finally {
      this.currentTask = null;
    }
  }
}

module.exports = new TaskRunner();
