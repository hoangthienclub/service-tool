const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const url = require('url');
const envManager = require('./env-manager');

class SshTerminalServer {
  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  handleConnection(ws, req) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const serverId = parsedUrl.searchParams.get('serverId');
      const initialCols = parseInt(parsedUrl.searchParams.get('cols') || '100', 10);
      const initialRows = parseInt(parsedUrl.searchParams.get('rows') || '30', 10);

      if (!serverId) {
        ws.send('\r\n\x1b[31m[ERROR] Thiếu tham số serverId!\x1b[0m\r\n');
        ws.close();
        return;
      }

      const servers = envManager.getSshServers();
      const server = servers.find(s => s.id === serverId);

      if (!server) {
        ws.send(`\r\n\x1b[31m[ERROR] Không tìm thấy cấu hình máy chủ SSH với ID: ${serverId}\x1b[0m\r\n`);
        ws.close();
        return;
      }

      const conn = new Client();
      let sshStream = null;
      let isClosed = false;

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        try { if (sshStream) sshStream.end(); } catch (e) {}
        try { conn.end(); } catch (e) {}
        try { if (ws.readyState === ws.OPEN) ws.close(); } catch (e) {}
      };

      ws.send(`\r\n\x1b[36m➜ Đang kết nối tới ${server.name} (${server.username || 'root'}@${server.host}:${server.port || 22})...\x1b[0m\r\n`);

      conn.on('ready', () => {
        ws.send(`\x1b[32m✔ Đã xác thực thành công! Đang mở shell PTY (${initialCols}x${initialRows})...\x1b[0m\r\n\r\n`);

        conn.shell({
          term: 'xterm-256color',
          cols: initialCols,
          rows: initialRows
        }, (err, stream) => {
          if (err) {
            ws.send(`\r\n\x1b[31m[ERROR] Lỗi khởi tạo Shell PTY: ${err.message}\x1b[0m\r\n`);
            return cleanup();
          }

          sshStream = stream;

          stream.on('data', (data) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(data);
            }
          });

          stream.on('close', () => {
            if (ws.readyState === ws.OPEN) {
              ws.send('\r\n\x1b[33m\r\n[Phiên SSH đã kết thúc]\x1b[0m\r\n');
            }
            cleanup();
          });

          stream.stderr.on('data', (data) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(data);
            }
          });
        });
      });

      conn.on('error', (err) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\n\x1b[31m[SSH Connection Error] ${err.message}\x1b[0m\r\n`);
        }
        cleanup();
      });

      conn.on('close', () => {
        cleanup();
      });

      ws.on('message', (message) => {
        // Check for JSON control messages (e.g. resize)
        try {
          const str = message.toString();
          if (str.startsWith('{') && str.endsWith('}')) {
            const parsed = JSON.parse(str);
            if (parsed.type === 'resize' && parsed.cols && parsed.rows && sshStream) {
              sshStream.setWindow(parsed.rows, parsed.cols, 0, 0);
              return;
            }
          }
        } catch (e) {}

        if (sshStream) {
          try {
            sshStream.write(message);
          } catch (err) {}
        }
      });

      ws.on('close', () => {
        cleanup();
      });

      ws.on('error', () => {
        cleanup();
      });

      // Prepare connection options
      const connectConfig = {
        host: server.host,
        port: parseInt(server.port || 22, 10),
        username: server.username || 'root',
        readyTimeout: 10000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3
      };

      if (server.authType === 'password') {
        let pass = server.password;
        if (!pass) {
          // Check if there is an existing tunnel for the same host & user with password
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
          ws.send('\r\n\x1b[31m[LỖI XÁC THỰC] Chưa có Mật khẩu (Password) cho máy chủ này!\x1b[0m\r\n');
          ws.send('\x1b[33m👉 Vui lòng nhấn vào biểu tượng Chỉnh sửa (bút chì) bên thẻ máy chủ để nhập mật khẩu.\x1b[0m\r\n\r\n');
          return cleanup();
        }

        connectConfig.password = pass;
        connectConfig.tryKeyboard = true;

        conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
          finish([pass]);
        });
      } else {
        const keyFile = server.sshKeyPath || server.identityFile;
        if (!keyFile) {
          ws.send('\r\n\x1b[31m[LỖI XÁC THỰC] Chưa chỉ định đường dẫn SSH Private Key!\x1b[0m\r\n');
          ws.send('\x1b[33m👉 Vui lòng nhấn Chỉnh sửa để cấu hình file key (~/.ssh/id_rsa).\x1b[0m\r\n\r\n');
          return cleanup();
        }

        const resolved = keyFile.replace(/^~/, process.env.HOME || '');
        if (!fs.existsSync(resolved)) {
          ws.send(`\r\n\x1b[31m[LỖI XÁC THỰC] Không tìm thấy file private key: ${resolved}\x1b[0m\r\n`);
          return cleanup();
        }

        try {
          connectConfig.privateKey = fs.readFileSync(resolved);
        } catch (e) {
          ws.send(`\r\n\x1b[31m[ERROR] Không thể đọc private key: ${e.message}\x1b[0m\r\n`);
          return cleanup();
        }
      }

      conn.connect(connectConfig);
    } catch (err) {
      if (ws.readyState === ws.OPEN) {
        ws.send(`\r\n\x1b[31m[Lỗi không xác định] ${err.message}\x1b[0m\r\n`);
        ws.close();
      }
    }
  }
}

module.exports = new SshTerminalServer();
