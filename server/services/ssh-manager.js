const { exec, execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('ssh2');
const envManager = require('./env-manager');

function isCommandAvailable(cmd) {
  try {
    if (process.platform === 'win32') {
      execSync(`where.exe ${cmd}`, { stdio: 'ignore', timeout: 1500 });
      return true;
    } else {
      execSync(`which ${cmd}`, { stdio: 'ignore', timeout: 1500 });
      return true;
    }
  } catch (e) {
    return false;
  }
}

function isWslEnvironment() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    if (fs.existsSync('/proc/version')) {
      const content = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      return content.includes('microsoft') || content.includes('wsl');
    }
  } catch (e) {}
  return false;
}

class SshManager {
  /**
   * Launch a native system terminal window connecting to the server
   * Supports macOS, Linux (Ubuntu, etc.), Windows, and WSL
   */
  async openNativeTerminal(server) {
    if (!server || !server.host) {
      throw new Error('Cấu hình máy chủ không hợp lệ');
    }

    const host = server.host;
    const port = server.port || 22;
    const user = server.username || 'root';
    let keyPath = '';
    let keyArg = '';

    if (server.authType === 'key') {
      const keyFile = server.sshKeyPath || server.identityFile;
      if (keyFile) {
        const resolved = keyFile.replace(/^~/, process.env.HOME || '');
        if (fs.existsSync(resolved)) {
          keyPath = resolved;
          keyArg = `-i "${resolved}"`;
        }
      }
    }

    let jumpArg = '';
    if (server.jumpHost) {
      jumpArg = `-J "${server.jumpHost}"`;
    }

    // Auto lookup password if missing
    let password = server.password;
    if (!password) {
      const matchingTunnel = envManager.getTunnels().find(t => 
        t.sshHost === server.host && (!server.username || t.sshUser === server.username) && t.password
      );
      if (matchingTunnel) {
        password = matchingTunnel.password;
      }
    }

    const sshCmd = `ssh -o StrictHostKeyChecking=accept-new -p ${port} ${keyArg} ${jumpArg} ${user}@${host}`.replace(/\s+/g, ' ').trim();
    const title = server.name || `${user}@${host}`;

    // 1. macOS (Darwin)
    if (process.platform === 'darwin') {
      return new Promise((resolve, reject) => {
        const escapedTitle = title.replace(/"/g, '\\"');
        const safeId = (server.id || 'server').replace(/[^a-zA-Z0-9_-]/g, '_');
        const tmpFile = path.join(os.tmpdir(), `ssh_connect_${safeId}_${Date.now()}.command`);

        let expectSnippet = '';
        if (password) {
          expectSnippet = `
export SSHPASS=${JSON.stringify(password)}
if command -v expect >/dev/null 2>&1; then
  /usr/bin/expect -c '
    set timeout -1
    set cmd [list ssh -o StrictHostKeyChecking=accept-new]
    ${keyPath ? `lappend cmd -i ${JSON.stringify(keyPath)}` : ''}
    ${server.jumpHost ? `lappend cmd -J ${JSON.stringify(server.jumpHost)}` : ''}
    lappend cmd -p "${port}" "${user}@${host}"
    eval spawn $cmd
    match_max 100000
    expect {
      -re "(yes/no|fingerprint)" {
        send "yes\\r"
        exp_continue
      }
      -re "(password|Password|passphrase):" {
        send "$env(SSHPASS)\\r"
      }
    }
    interact
  '
else
  ${sshCmd}
fi
`;
        } else {
          expectSnippet = `${sshCmd}`;
        }

        const fileContent = `#!/bin/bash
clear
echo "=========================================="
echo "🚀 Kết nối SSH tới: ${escapedTitle} (${user}@${host})"
echo "=========================================="
trap 'rm -f "$0"' EXIT
${expectSnippet}
`;

        fs.writeFileSync(tmpFile, fileContent, { mode: 0o755 });
        exec(`open "${tmpFile}"`, (openErr) => {
          if (openErr) {
            return reject(new Error(`Không thể mở macOS Terminal: ${openErr.message}`));
          }
          resolve({ success: true, message: 'Đã mở macOS Terminal', terminal: 'Terminal.app' });
        });
      });
    }

    // 2. Windows Native (win32)
    if (process.platform === 'win32') {
      return new Promise((resolve, reject) => {
        // Priority 1: Windows Terminal (wt.exe)
        if (isCommandAvailable('wt.exe')) {
          const psCommand = `Clear-Host; Write-Host "==========================================" -ForegroundColor Cyan; Write-Host "🚀 Kết nối SSH tới: ${title} (${user}@${host})" -ForegroundColor Green; Write-Host "==========================================" -ForegroundColor Cyan; ${sshCmd}`;
          const wtCmd = `cmd.exe /c start wt.exe --title "${title}" powershell.exe -NoExit -Command "${psCommand.replace(/"/g, '\\"')}"`;
          exec(wtCmd, (err) => {
            if (err) return reject(new Error(`Lỗi mở Windows Terminal: ${err.message}`));
            resolve({ success: true, message: 'Đã mở Windows Terminal', terminal: 'Windows Terminal' });
          });
          return;
        }

        // Priority 2: PowerShell
        if (isCommandAvailable('powershell.exe')) {
          const psCommand = `Clear-Host; Write-Host "==========================================" -ForegroundColor Cyan; Write-Host "🚀 Kết nối SSH tới: ${title} (${user}@${host})" -ForegroundColor Green; Write-Host "==========================================" -ForegroundColor Cyan; ${sshCmd}`;
          const psCmd = `cmd.exe /c start powershell.exe -NoExit -Command "${psCommand.replace(/"/g, '\\"')}"`;
          exec(psCmd, (err) => {
            if (err) return reject(new Error(`Lỗi mở PowerShell: ${err.message}`));
            resolve({ success: true, message: 'Đã mở PowerShell', terminal: 'PowerShell' });
          });
          return;
        }

        // Priority 3: CMD
        const cmd = `cmd.exe /c start "${title}" cmd.exe /k "cls & echo ========================================== & echo 🚀 Ket noi SSH toi: ${title} (${user}@${host}) & echo ========================================== & ${sshCmd}"`;
        exec(cmd, (err) => {
          if (err) return reject(new Error(`Lỗi mở Command Prompt: ${err.message}`));
          resolve({ success: true, message: 'Đã mở Command Prompt', terminal: 'CMD' });
        });
      });
    }

    // 3. WSL (Windows Subsystem for Linux)
    if (isWslEnvironment()) {
      return new Promise((resolve, reject) => {
        const innerCmd = `clear; echo "=========================================="; echo "🚀 Kết nối SSH tới: ${title} (${user}@${host})"; echo "=========================================="; ${sshCmd}; exec bash`;

        // Check if Windows Interop cmd.exe or wt.exe is reachable
        const canUseCmd = isCommandAvailable('cmd.exe') || isCommandAvailable('/mnt/c/Windows/System32/cmd.exe');
        if (canUseCmd) {
          const cmdBin = isCommandAvailable('cmd.exe') ? 'cmd.exe' : '/mnt/c/Windows/System32/cmd.exe';
          const launchCmd = `${cmdBin} /c start wt.exe wsl.exe bash -c ${JSON.stringify(innerCmd)}`;
          exec(launchCmd, (err) => {
            if (!err) {
              return resolve({ success: true, message: 'Đã mở Windows Terminal từ WSL', terminal: 'Windows Terminal (WSL)' });
            }
            this.launchLinuxTerminal(server, title, user, host, sshCmd, resolve, reject);
          });
          return;
        }

        this.launchLinuxTerminal(server, title, user, host, sshCmd, password, keyPath, port, resolve, reject);
      });
    }

    // 4. Linux / Ubuntu
    return new Promise((resolve, reject) => {
      this.launchLinuxTerminal(server, title, user, host, sshCmd, password, keyPath, port, resolve, reject);
    });
  }

  /**
   * Helper to find and spawn available Linux desktop terminals
   */
  launchLinuxTerminal(server, title, user, host, sshCmd, password, keyPath, port, resolve, reject) {
    let expectSnippet = '';
    if (password) {
      expectSnippet = `export SSHPASS=${JSON.stringify(password)}; if command -v expect >/dev/null 2>&1; then /usr/bin/expect -c 'set timeout -1; set cmd [list ssh -o StrictHostKeyChecking=accept-new]; ${keyPath ? `lappend cmd -i ${JSON.stringify(keyPath)}; ` : ''}${server.jumpHost ? `lappend cmd -J ${JSON.stringify(server.jumpHost)}; ` : ''}lappend cmd -p "${port}" "${user}@${host}"; eval spawn $cmd; match_max 100000; expect { -re "(yes/no|fingerprint)" { send "yes\\r"; exp_continue } -re "(password|Password|passphrase):" { send "$env(SSHPASS)\\r" } }; interact'; else ${sshCmd}; fi`;
    } else {
      expectSnippet = `${sshCmd}`;
    }

    const innerBash = `clear; echo "=========================================="; echo "🚀 Kết nối SSH tới: ${title.replace(/"/g, '\\"')} (${user}@${host})"; echo "=========================================="; ${expectSnippet}; exec bash`;

    const linuxTerminals = [
      { bin: 'x-terminal-emulator', args: ['-e', `bash -c ${JSON.stringify(innerBash)}`] },
      { bin: 'gnome-terminal', args: ['--', 'bash', '-c', innerBash] },
      { bin: 'konsole', args: ['-e', 'bash', '-c', innerBash] },
      { bin: 'xfce4-terminal', args: ['-e', `bash -c ${JSON.stringify(innerBash)}`] },
      { bin: 'tilix', args: ['-e', `bash -c ${JSON.stringify(innerBash)}`] },
      { bin: 'alacritty', args: ['-e', 'bash', '-c', innerBash] },
      { bin: 'kitty', args: ['bash', '-c', innerBash] },
      { bin: 'xterm', args: ['-title', title, '-e', 'bash', '-c', innerBash] }
    ];

    for (const term of linuxTerminals) {
      if (isCommandAvailable(term.bin)) {
        try {
          const child = spawn(term.bin, term.args, {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          return resolve({ success: true, message: `Đã mở terminal ${term.bin}`, terminal: term.bin });
        } catch (err) {
          continue;
        }
      }
    }

    return reject(new Error('Không tìm thấy terminal đồ họa nào khả dụng trên Linux (gnome-terminal, konsole, xfce4-terminal, xterm...)'));
  }

  /**
   * Test SSH connectivity using ssh2 Client
   */
  async testConnection(server) {
    return new Promise((resolve) => {
      const conn = new Client();
      let finished = false;

      const finish = (result) => {
        if (!finished) {
          finished = true;
          try { conn.end(); } catch (e) {}
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish({ success: false, error: 'Hết thời gian chờ kết nối (Timeout 5s)' });
      }, 5000);

      conn.on('ready', () => {
        clearTimeout(timer);
        finish({ success: true, message: 'Xác thực SSH thành công!' });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        finish({ success: false, error: err.message });
      });

      const config = {
        host: server.host,
        port: parseInt(server.port || 22, 10),
        username: server.username || 'root',
        readyTimeout: 5000
      };

      if (server.authType === 'password') {
        let pass = server.password;
        if (!pass) {
          const matchingTunnel = envManager.getTunnels().find(t => 
            t.sshHost === server.host && (!server.username || t.sshUser === server.username) && t.password
          );
          if (matchingTunnel) {
            pass = matchingTunnel.password;
            server.password = pass;
            envManager.saveSshServer(server);
          }
        }
        if (!pass) {
          return finish({ success: false, error: 'Chưa có mật khẩu cho máy chủ này!' });
        }
        config.password = pass;
        config.tryKeyboard = true;

        conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finishInteractive) => {
          finishInteractive([pass]);
        });
      } else {
        const keyFile = server.sshKeyPath || server.identityFile;
        if (keyFile) {
          const resolved = keyFile.replace(/^~/, process.env.HOME || '');
          if (fs.existsSync(resolved)) {
            try {
              config.privateKey = fs.readFileSync(resolved);
            } catch (e) {
              return finish({ success: false, error: `Không thể đọc file key: ${e.message}` });
            }
          }
        }
      }

      try {
        conn.connect(config);
      } catch (err) {
        clearTimeout(timer);
        finish({ success: false, error: err.message });
      }
    });
  }

  /**
   * Convert an SSH server profile into a Port Forwarding Tunnel
   */
  convertToTunnel(serverId, tunnelOptions = {}) {
    const servers = envManager.getSshServers();
    const server = servers.find(s => s.id === serverId);
    if (!server) {
      throw new Error('Không tìm thấy cấu hình server');
    }

    const newTunnel = envManager.saveTunnel({
      name: tunnelOptions.name || `${server.name} Tunnel`,
      localPort: tunnelOptions.localPort || 27017,
      remoteHost: tunnelOptions.remoteHost || '127.0.0.1',
      remotePort: tunnelOptions.remotePort || 27017,
      sshHost: server.host,
      sshPort: server.port,
      sshUser: server.username,
      authType: server.authType,
      password: server.password,
      sshKeyPath: server.sshKeyPath,
      identityFile: server.identityFile,
      jumpHost: server.jumpHost,
      description: `Được tạo từ SSH Profile: ${server.name}`
    });

    return newTunnel;
  }
}

module.exports = new SshManager();
