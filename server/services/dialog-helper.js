const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class DialogHelper {
  constructor() {
    this._isWsl = null;
  }

  isWsl() {
    if (this._isWsl !== null) return this._isWsl;
    if (process.platform !== 'linux') {
      this._isWsl = false;
      return false;
    }
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      this._isWsl = true;
      return true;
    }
    try {
      if (fs.existsSync('/proc/version')) {
        const content = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
        if (content.includes('microsoft') || content.includes('wsl')) {
          this._isWsl = true;
          return true;
        }
      }
    } catch (e) {}
    this._isWsl = false;
    return false;
  }

  /**
   * Convert POSIX path to Windows path (when in WSL)
   */
  async toWindowsPath(posixPath) {
    if (!posixPath || !this.isWsl()) return posixPath;
    return new Promise((resolve) => {
      exec(`wslpath -w "${posixPath.replace(/"/g, '\\"')}"`, (err, stdout) => {
        if (err || !stdout) resolve(posixPath);
        else resolve(stdout.trim());
      });
    });
  }

  /**
   * Convert Windows path to WSL POSIX path
   */
  async toWslPath(winPath) {
    if (!winPath || !this.isWsl()) return winPath;
    return new Promise((resolve) => {
      exec(`wslpath -u "${winPath.replace(/"/g, '\\"')}"`, (err, stdout) => {
        if (err || !stdout) resolve(winPath.replace(/\\/g, '/'));
        else resolve(stdout.trim());
      });
    });
  }

  /**
   * Open Native Folder Browser Dialog
   */
  async browseDirectory(options = {}) {
    const promptText = options.prompt || 'Chọn thư mục:';
    let defaultDir = options.defaultDir || '';

    // 1. macOS (Darwin)
    if (process.platform === 'darwin') {
      return new Promise((resolve) => {
        let script = `osascript -e 'try' -e 'set folderPath to POSIX path of (choose folder with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return folderPath' -e 'on error' -e 'return ""' -e 'end try'`;
        if (defaultDir && fs.existsSync(defaultDir)) {
          script = `osascript -e 'try' -e 'set defaultFolder to POSIX file "${defaultDir.replace(/"/g, '\\"')}"' -e 'set folderPath to POSIX path of (choose folder default location defaultFolder with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return folderPath' -e 'on error' -e 'return ""' -e 'end try'`;
        }

        exec(script, (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const selected = stdout.trim().replace(/\/+$/, '');
          if (!selected) return resolve({ success: false, cancelled: true });
          return resolve({ success: true, path: selected });
        });
      });
    }

    // 2. Windows Native (win32)
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        const cleanPrompt = promptText.replace(/["'`]/g, '');
        const cleanDir = (defaultDir && fs.existsSync(defaultDir)) ? defaultDir.replace(/"/g, '`"') : '';
        
        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "${cleanPrompt}"
$f.ShowNewFolderButton = $true
${cleanDir ? `$f.SelectedPath = "${cleanDir}"` : ''}
$res = $f.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($f.SelectedPath)
}
`.trim();

        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const cmd = `powershell.exe -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

        exec(cmd, { encoding: 'utf8' }, (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const selected = stdout.trim().replace(/[\r\n]+/g, '');
          if (!selected) return resolve({ success: false, cancelled: true });
          const normalized = selected.replace(/\\/g, '/');
          return resolve({ success: true, path: normalized });
        });
      });
    }

    // 3. WSL2 on Windows (Linux + powershell.exe)
    if (this.isWsl()) {
      let winDefaultDir = '';
      if (defaultDir) {
        winDefaultDir = await this.toWindowsPath(defaultDir);
      }

      return new Promise((resolve) => {
        const cleanPrompt = promptText.replace(/["'`]/g, '');
        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "${cleanPrompt}"
$f.ShowNewFolderButton = $true
${winDefaultDir ? `$f.SelectedPath = "${winDefaultDir.replace(/"/g, '`"')}"` : ''}
$res = $f.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($f.SelectedPath)
}
`.trim();

        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const cmd = `powershell.exe -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

        exec(cmd, { encoding: 'utf8' }, async (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const winSelected = stdout.trim().replace(/[\r\n]+/g, '');
          if (!winSelected) return resolve({ success: false, cancelled: true });

          const wslPath = await this.toWslPath(winSelected);
          return resolve({ success: true, path: wslPath, winPath: winSelected });
        });
      });
    }

    // 4. Linux Desktop (Zenity / KDialog fallback)
    return new Promise((resolve) => {
      exec(`zenity --file-selection --directory --title="${promptText.replace(/"/g, '\\"')}"`, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          return resolve({ success: true, path: stdout.trim().replace(/\/+$/, '') });
        }
        exec(`kdialog --getexistingdirectory "${defaultDir || '.'}" --title "${promptText.replace(/"/g, '\\"')}"`, (err2, stdout2) => {
          if (!err2 && stdout2 && stdout2.trim()) {
            return resolve({ success: true, path: stdout2.trim().replace(/\/+$/, '') });
          }
          return resolve({
            success: false,
            error: 'Không tìm thấy tiện ích chọn thư mục GUI (PowerShell / Zenity / KDialog). Bạn có thể nhập đường dẫn thủ công.'
          });
        });
      });
    });
  }

  /**
   * Open Native File Picker Dialog
   */
  async browseFile(options = {}) {
    const promptText = options.prompt || 'Chọn file:';
    let defaultDir = options.defaultDir || '';

    // Helper to format file return object
    const formatFileResult = (selectedPath) => {
      const filename = path.basename(selectedPath);
      const ext = path.extname(selectedPath).toLowerCase();
      let defaultRunner = 'bash';
      if (ext === '.js' || ext === '.mjs') defaultRunner = 'node';
      else if (ext === '.ts') defaultRunner = 'pnpm ts-node';
      else if (ext === '.py') defaultRunner = 'python3';
      else if (ext === '.sh') defaultRunner = 'bash';
      else if (ext === '.bat' || ext === '.cmd') defaultRunner = 'cmd /c';
      else if (ext === '.ps1') defaultRunner = 'powershell -File';

      let relPath = selectedPath;
      if (defaultDir) {
        const rel = path.relative(defaultDir, selectedPath);
        relPath = rel.startsWith('.') ? rel : `./${rel}`;
      }

      return {
        success: true,
        path: selectedPath,
        filename,
        relativePath: relPath,
        ext,
        defaultRunner,
        suggestedCommand: `${defaultRunner} ${relPath}`
      };
    };

    // 1. macOS (Darwin)
    if (process.platform === 'darwin') {
      return new Promise((resolve) => {
        let script = `osascript -e 'try' -e 'set filePath to POSIX path of (choose file with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return filePath' -e 'on error' -e 'return ""' -e 'end try'`;
        if (defaultDir && fs.existsSync(defaultDir)) {
          script = `osascript -e 'try' -e 'set defaultFolder to POSIX file "${defaultDir.replace(/"/g, '\\"')}"' -e 'set filePath to POSIX path of (choose file default location defaultFolder with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return filePath' -e 'on error' -e 'return ""' -e 'end try'`;
        }

        exec(script, (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const selected = stdout.trim();
          if (!selected) return resolve({ success: false, cancelled: true });
          return resolve(formatFileResult(selected));
        });
      });
    }

    // 2. Windows Native (win32)
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        const cleanPrompt = promptText.replace(/["'`]/g, '');
        const cleanDir = (defaultDir && fs.existsSync(defaultDir)) ? defaultDir.replace(/"/g, '`"') : '';

        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Title = "${cleanPrompt}"
$f.Filter = "Scripts & Executables (*.sh;*.ts;*.js;*.py;*.bat;*.cmd;*.ps1)|*.sh;*.ts;*.js;*.py;*.bat;*.cmd;*.ps1|All Files (*.*)|*.*"
${cleanDir ? `$f.InitialDirectory = "${cleanDir}"` : ''}
$res = $f.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($f.SelectedPath)
}
`.trim();

        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const cmd = `powershell.exe -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

        exec(cmd, { encoding: 'utf8' }, (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const selected = stdout.trim().replace(/[\r\n]+/g, '');
          if (!selected) return resolve({ success: false, cancelled: true });
          const normalized = selected.replace(/\\/g, '/');
          return resolve(formatFileResult(normalized));
        });
      });
    }

    // 3. WSL2 on Windows (Linux + powershell.exe)
    if (this.isWsl()) {
      let winDefaultDir = '';
      if (defaultDir) {
        winDefaultDir = await this.toWindowsPath(defaultDir);
      }

      return new Promise((resolve) => {
        const cleanPrompt = promptText.replace(/["'`]/g, '');
        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Title = "${cleanPrompt}"
$f.Filter = "Scripts & Executables (*.sh;*.ts;*.js;*.py;*.bat;*.cmd;*.ps1)|*.sh;*.ts;*.js;*.py;*.bat;*.cmd;*.ps1|All Files (*.*)|*.*"
${winDefaultDir ? `$f.InitialDirectory = "${winDefaultDir.replace(/"/g, '`"')}"` : ''}
$res = $f.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($f.SelectedPath)
}
`.trim();

        const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
        const cmd = `powershell.exe -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

        exec(cmd, { encoding: 'utf8' }, async (err, stdout) => {
          if (err || !stdout) return resolve({ success: false, cancelled: true });
          const winSelected = stdout.trim().replace(/[\r\n]+/g, '');
          if (!winSelected) return resolve({ success: false, cancelled: true });

          const wslPath = await this.toWslPath(winSelected);
          return resolve(formatFileResult(wslPath));
        });
      });
    }

    // 4. Linux Desktop (Zenity / KDialog fallback)
    return new Promise((resolve) => {
      exec(`zenity --file-selection --title="${promptText.replace(/"/g, '\\"')}"`, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          return resolve(formatFileResult(stdout.trim()));
        }
        exec(`kdialog --getopenfilename "${defaultDir || '.'}" --title "${promptText.replace(/"/g, '\\"')}"`, (err2, stdout2) => {
          if (!err2 && stdout2 && stdout2.trim()) {
            return resolve(formatFileResult(stdout2.trim()));
          }
          return resolve({
            success: false,
            error: 'Không tìm thấy tiện ích chọn file GUI. Bạn có thể nhập đường dẫn thủ công.'
          });
        });
      });
    });
  }
}

module.exports = new DialogHelper();
