const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const envManager = require('./env-manager');

class SshManager {
  /**
   * Launch a native macOS Terminal or iTerm2 window connecting to the server
   */
  async openNativeTerminal(server) {
    if (!server || !server.host) {
      throw new Error('Cấu hình máy chủ không hợp lệ');
    }

    if (process.platform !== 'darwin') {
      throw new Error('Tính năng mở Native Terminal chỉ hỗ trợ trên hệ điều hành macOS');
    }

    const host = server.host;
    const port = server.port || 22;
    const user = server.username || 'root';
    let keyArg = '';

    if (server.authType === 'key') {
      const keyFile = server.sshKeyPath || server.identityFile;
      if (keyFile) {
        const resolved = keyFile.replace(/^~/, process.env.HOME || '');
        if (fs.existsSync(resolved)) {
          keyArg = `-i "${resolved}"`;
        }
      }
    }

    let jumpArg = '';
    if (server.jumpHost) {
      jumpArg = `-J "${server.jumpHost}"`;
    }

    const sshCmd = `ssh -p ${port} ${keyArg} ${jumpArg} ${user}@${host}`.replace(/\s+/g, ' ').trim();

    return new Promise((resolve, reject) => {
      const escapedTitle = (server.name || 'SSH').replace(/"/g, '\\"');
      const escapedCmd = sshCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      let passwordHint = '';
      if (server.authType === 'password' && server.password) {
        passwordHint = `echo "🔑 Mật khẩu đã lưu: ${server.password.replace(/"/g, '\\"')}"; echo ""; `;
      }

      const script = `
        tell application "Terminal"
          do script "clear; echo \\"==========================================\\"; echo \\"🚀 Kết nối SSH tới: ${escapedTitle} (${user}@${host})\\"; echo \\"==========================================\\"; ${passwordHint}${escapedCmd}"
          activate
        end tell
      `;

      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err) {
          return reject(new Error(`Không thể mở Terminal: ${err.message}`));
        }
        resolve({ success: true, message: 'Đã mở Native Terminal' });
      });
    });
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
