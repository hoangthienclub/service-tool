const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class WslHelper {
  constructor() {
    this._distrosCache = null;
    this._cacheTime = 0;
  }

  /**
   * Check if WSL is available on this system
   */
  isWslAvailable() {
    if (process.platform === 'win32') {
      try {
        execSync('wsl.exe --status', { stdio: 'ignore', timeout: 2000 });
        return true;
      } catch (e) {
        return false;
      }
    }
    if (process.platform === 'linux') {
      if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
      try {
        if (fs.existsSync('/proc/version')) {
          const content = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
          return content.includes('microsoft') || content.includes('wsl');
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * Get installed WSL Distros list
   */
  async getDistros(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._distrosCache && (now - this._cacheTime < 30000)) {
      return this._distrosCache;
    }

    const defaultResult = {
      isAvailable: false,
      distros: [],
      defaultDistro: 'Ubuntu'
    };

    if (process.platform !== 'win32' && !this.isWslAvailable()) {
      return defaultResult;
    }

    return new Promise((resolve) => {
      // Execute wsl.exe -l -q to get list of distribution names
      exec('wsl.exe -l -q', { encoding: 'buffer', timeout: 5000 }, (err, stdout) => {
        if (err || !stdout || stdout.length === 0) {
          // Fallback check: if we are in WSL, we know the current distro
          const current = process.env.WSL_DISTRO_NAME || 'Ubuntu';
          const res = {
            isAvailable: this.isWslAvailable(),
            distros: [current],
            defaultDistro: current
          };
          this._distrosCache = res;
          this._cacheTime = now;
          return resolve(res);
        }

        let outputStr = '';
        // wsl.exe on Windows outputs UTF-16LE buffer
        if (stdout.indexOf(0x00) !== -1) {
          outputStr = stdout.toString('utf16le');
        } else {
          outputStr = stdout.toString('utf8');
        }

        const rawList = outputStr
          .replace(/\0/g, '')
          .split(/[\r\n]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.includes('Windows Subsystem for Linux'));

        // Filter out docker helper distros if standard ones exist, or keep all
        const distros = rawList.length > 0 ? rawList : ['Ubuntu'];
        const defaultDistro = distros.find(d => !d.toLowerCase().includes('docker')) || distros[0] || 'Ubuntu';

        const res = {
          isAvailable: true,
          distros,
          defaultDistro
        };
        this._distrosCache = res;
        this._cacheTime = now;
        return resolve(res);
      });
    });
  }

  /**
   * Convert Linux Path in WSL to Windows UNC Path
   * e.g. /home/user/api -> \\wsl.localhost\Ubuntu\home\user\api
   */
  resolveWslPathToWindows(linuxPath, distro = 'Ubuntu') {
    if (!linuxPath || typeof linuxPath !== 'string') return '';
    let clean = linuxPath.trim().replace(/\\/g, '/');

    // Already a Windows path or UNC path
    if (/^[a-zA-Z]:/i.test(clean)) return clean;
    if (clean.startsWith('//wsl.localhost/') || clean.startsWith('\\\\wsl.localhost\\')) {
      return clean.replace(/\//g, '\\');
    }
    if (clean.startsWith('//wsl$/') || clean.startsWith('\\\\wsl$\\')) {
      return clean.replace(/\//g, '\\');
    }

    // Strip leading /mnt/c/ -> C:/
    const mntMatch = clean.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
    if (mntMatch) {
      const drive = mntMatch[1].toUpperCase();
      const rest = mntMatch[2];
      return `${drive}:\\${rest.replace(/\//g, '\\')}`;
    }

    // Ensure leading slash
    if (!clean.startsWith('/')) clean = '/' + clean;

    const wslLocalhost = `\\\\wsl.localhost\\${distro}${clean.replace(/\//g, '\\')}`;
    const wslDollar = `\\\\wsl$\\${distro}${clean.replace(/\//g, '\\')}`;

    // Prefer \\wsl.localhost if exists, or \\wsl$
    if (fs.existsSync(wslLocalhost)) return wslLocalhost;
    if (fs.existsSync(wslDollar)) return wslDollar;
    return wslLocalhost;
  }

  /**
   * Convert Windows UNC Path back to WSL Linux Path
   * e.g. \\wsl.localhost\Ubuntu\home\user\api -> /home/user/api
   */
  resolveWindowsPathToWsl(winPath) {
    if (!winPath || typeof winPath !== 'string') return '';
    const clean = winPath.trim().replace(/\\/g, '/');

    // Matches //wsl.localhost/Ubuntu/home/user or //wsl$/Ubuntu/home/user
    const wslMatch = clean.match(/^\/\/(?:wsl\.localhost|wsl\$)\/[^\/]+(\/.*)$/i);
    if (wslMatch) {
      return wslMatch[1];
    }

    // Matches C:/Users/... -> /mnt/c/Users/...
    const driveMatch = clean.match(/^([a-zA-Z]):\/(.*)$/);
    if (driveMatch) {
      return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
    }

    return clean;
  }

  /**
   * Inspect Directory inside WSL2
   */
  async inspectWslDirectory(linuxPath, distro = 'Ubuntu') {
    if (!linuxPath || typeof linuxPath !== 'string') {
      return { success: false, error: 'Đường dẫn không hợp lệ', exists: false };
    }

    const cleanLinuxPath = linuxPath.trim();
    
    // If Dashboard itself is running inside Linux/WSL2
    if (process.platform === 'linux') {
      const targetDir = path.resolve(cleanLinuxPath);
      if (fs.existsSync(targetDir)) {
        return this._inspectLocalDir(targetDir, cleanLinuxPath);
      }
    }

    // If Dashboard is running on Windows Host: try UNC Path first (Fast & Direct)
    const uncPath = this.resolveWslPathToWindows(cleanLinuxPath, distro);
    if (uncPath && fs.existsSync(uncPath)) {
      const result = this._inspectLocalDir(uncPath, cleanLinuxPath);
      result.isWsl = true;
      result.wslDistro = distro;
      result.wslPath = cleanLinuxPath;
      result.uncPath = uncPath;
      return result;
    }

    // Fallback: Check via wsl.exe command execution
    return new Promise((resolve) => {
      const cmd = `wsl.exe -d ${distro} --cd "${cleanLinuxPath}" sh -c "test -d . && echo EXISTS"`;
      exec(cmd, { timeout: 4000 }, (err, stdout) => {
        if (err || !stdout || !stdout.includes('EXISTS')) {
          return resolve({
            success: false,
            exists: false,
            error: `Không tìm thấy thư mục "${cleanLinuxPath}" trong WSL2 (${distro})`,
            dirPath: cleanLinuxPath,
            isWsl: true,
            wslDistro: distro
          });
        }

        // Read package.json and .env via WSL
        const readCmd = `wsl.exe -d ${distro} --cd "${cleanLinuxPath}" sh -c "cat package.json 2>/dev/null || true; echo '---ENV_DELIMITER---'; cat .env 2>/dev/null || true"`;
        exec(readCmd, { timeout: 5000 }, (err2, stdout2) => {
          let pkg = null;
          let parsedEnv = {};
          let envSource = null;

          if (!err2 && stdout2) {
            const parts = stdout2.split('---ENV_DELIMITER---');
            const pkgContent = parts[0] ? parts[0].trim() : '';
            const envContent = parts[1] ? parts[1].trim() : '';

            if (pkgContent) {
              try { pkg = JSON.parse(pkgContent); } catch (e) {}
            }
            if (envContent) {
              parsedEnv = this._parseEnvText(envContent);
              envSource = '.env';
            }
          }

          const pkgInfo = pkg ? this._extractPackageInfo(pkg, 'npm') : null;

          return resolve({
            success: true,
            exists: true,
            isWsl: true,
            wslDistro: distro,
            wslPath: cleanLinuxPath,
            dirPath: cleanLinuxPath,
            envSource,
            detectedEnv: parsedEnv,
            envKeys: Object.keys(parsedEnv),
            envCount: Object.keys(parsedEnv).length,
            packageInfo: pkgInfo,
            suggestedCommand: pkgInfo?.suggestedCommand || 'npm run dev',
            suggestedRunner: pkgInfo?.runner || 'npm',
            suggestedArgs: pkgInfo?.args || 'run dev',
            name: pkg?.name || path.basename(cleanLinuxPath)
          });
        });
      });
    });
  }

  _inspectLocalDir(dirPath, originalLinuxPath) {
    let parsedEnv = {};
    let envSource = null;

    const envCandidates = ['.env', '.env.local', '.env.example', '.env.sample', '.env.dist'];
    for (const file of envCandidates) {
      const fullPath = path.join(dirPath, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          parsedEnv = this._parseEnvText(content);
          envSource = file;
          break;
        } catch (e) {}
      }
    }

    let packageInfo = null;
    const pkgPath = path.join(dirPath, 'package.json');
    let pkgManager = 'npm';
    if (fs.existsSync(path.join(dirPath, 'yarn.lock'))) pkgManager = 'yarn';
    else if (fs.existsSync(path.join(dirPath, 'pnpm-lock.yaml'))) pkgManager = 'pnpm';
    else if (fs.existsSync(path.join(dirPath, 'bun.lockb')) || fs.existsSync(path.join(dirPath, 'bun.lock'))) pkgManager = 'bun';

    let pkg = null;
    if (fs.existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        packageInfo = this._extractPackageInfo(pkg, pkgManager);
      } catch (e) {}
    }

    return {
      success: true,
      exists: true,
      dirPath: originalLinuxPath || dirPath,
      localDir: dirPath,
      envSource,
      detectedEnv: parsedEnv,
      envKeys: Object.keys(parsedEnv),
      envCount: Object.keys(parsedEnv).length,
      packageInfo,
      suggestedCommand: packageInfo?.suggestedCommand || `${pkgManager} run dev`,
      suggestedRunner: packageInfo?.runner || pkgManager,
      suggestedArgs: packageInfo?.args || 'run dev',
      name: pkg?.name || path.basename(originalLinuxPath || dirPath)
    };
  }

  _extractPackageInfo(pkg, pkgManager) {
    const scripts = pkg.scripts || {};
    const scriptKeys = Object.keys(scripts);
    const priorityNames = ['start:dev', 'dev', 'start:local', 'dev:local', 'serve', 'start', 'server', 'watch'];
    let bestKey = priorityNames.find(k => scriptKeys.includes(k)) || scriptKeys[0] || '';

    const scriptSuggestions = scriptKeys.map(k => {
      const runArgs = pkgManager === 'npm' ? `run ${k}` : k;
      return {
        name: k,
        rawCommand: scripts[k],
        script: pkgManager,
        args: runArgs,
        display: `${pkgManager} ${runArgs}`
      };
    });

    let bestScript = null;
    if (bestKey) {
      const bestArgs = pkgManager === 'npm' ? `run ${bestKey}` : bestKey;
      bestScript = {
        name: bestKey,
        rawCommand: scripts[bestKey],
        script: pkgManager,
        args: bestArgs,
        display: `${pkgManager} ${bestArgs}`
      };
    }

    return {
      name: pkg.name || '',
      version: pkg.version || '',
      packageManager: pkgManager,
      runner: pkgManager,
      args: bestScript ? bestScript.args : (pkgManager === 'npm' ? 'run dev' : 'dev'),
      suggestedCommand: bestScript ? bestScript.display : `${pkgManager} run dev`,
      bestScript,
      scripts: scriptSuggestions
    };
  }

  _parseEnvText(content) {
    const parsed = {};
    if (!content) return parsed;
    for (const line of content.split('\n')) {
      const clean = line.trim().replace(/^export\s+/, '');
      if (!clean || clean.startsWith('#')) continue;
      const eq = clean.indexOf('=');
      if (eq > 0) {
        const k = clean.slice(0, eq).trim();
        const v = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (k) parsed[k] = v;
      }
    }
    return parsed;
  }
}

module.exports = new WslHelper();
