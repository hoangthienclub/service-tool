const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const envManager = require('./services/env-manager');
const processManager = require('./services/process-manager');
const taskRunner = require('./services/task-runner');

const PORT = parseInt(process.env.PORT || '48899', 10);
const DIST_DIR = path.resolve(__dirname, '../dist');

// SSE clients for real-time logs and status
const sseClients = new Set();

function sendSseEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Forward events to SSE
processManager.on('log', (data) => sendSseEvent('service-log', data));
processManager.on('status-change', (data) => sendSseEvent('status-change', data));
processManager.on('log-cleared', (data) => sendSseEvent('log-cleared', data));

taskRunner.on('task-start', (data) => sendSseEvent('task-start', data));
taskRunner.on('task-log', (data) => sendSseEvent('task-log', data));
taskRunner.on('task-finish', (data) => sendSseEvent('task-finish', data));

// Helper: read request body
function getRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Helper: send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // SSE Endpoint: /api/events
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    sseClients.add(res);

    // Send initial status immediately
    res.write(`event: initial-state\ndata: ${JSON.stringify({
      statuses: processManager.getAllStatuses(),
      services: envManager.getServices()
    })}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // REST API Routes
  if (pathname.startsWith('/api/')) {
    try {
      // GET /api/services
      if (pathname === '/api/services' && method === 'GET') {
        const services = envManager.getServices();
        const statuses = processManager.getAllStatuses();
        const combined = services.map(s => ({
          ...s,
          statusInfo: statuses[s.id] || { status: 'STOPPED' }
        }));
        return sendJson(res, 200, { success: true, services: combined });
      }

      // GET /api/templates
      if (pathname === '/api/templates' && method === 'GET') {
        const templates = envManager.getTemplates();
        return sendJson(res, 200, { success: true, templates });
      }

      // POST /api/services (Create new service)
      if (pathname === '/api/services' && method === 'POST') {
        const body = await getRequestBody(req);
        const newService = envManager.createService(body);
        sendSseEvent('service-updated', newService);
        return sendJson(res, 201, { success: true, service: newService });
      }

      // PUT /api/services/:id (Update service)
      const matchPutService = pathname.match(/^\/api\/services\/([^/]+)$/);
      if (matchPutService && method === 'PUT') {
        const serviceId = matchPutService[1];
        const body = await getRequestBody(req);
        const updated = envManager.updateService(serviceId, body);
        sendSseEvent('service-updated', updated);
        return sendJson(res, 200, { success: true, service: updated });
      }

      // DELETE /api/services/:id (Delete service)
      const matchDelService = pathname.match(/^\/api\/services\/([^/]+)$/);
      if (matchDelService && method === 'DELETE') {
        const serviceId = matchDelService[1];
        await processManager.killServicePort(serviceId);
        const result = envManager.deleteService(serviceId);
        sendSseEvent('service-deleted', { serviceId });
        return sendJson(res, 200, { success: true, ...result });
      }

      // GET /api/paths (Get workspace root and custom service paths)
      if (pathname === '/api/paths' && method === 'GET') {
        const config = envManager.getPathsConfig();
        return sendJson(res, 200, { success: true, ...config });
      }

      // POST /api/paths (Update paths config)
      if (pathname === '/api/paths' && method === 'POST') {
        const body = await getRequestBody(req);
        const config = envManager.updatePathsConfig(body);
        return sendJson(res, 200, { success: true, ...config });
      }

      // POST /api/paths/reset (Reset paths config)
      if (pathname === '/api/paths/reset' && method === 'POST') {
        const config = envManager.resetPathsConfig();
        return sendJson(res, 200, { success: true, ...config });
      }

      // POST or GET /api/browse-directory (Native macOS Finder Folder Picker)
      if (pathname === '/api/browse-directory' && (method === 'POST' || method === 'GET')) {
        let promptText = 'Chọn thư mục dự án:';
        try {
          if (method === 'POST') {
            const body = await getRequestBody(req);
            if (body && body.prompt) promptText = body.prompt;
          }
        } catch (e) {}

        if (process.platform === 'darwin') {
          const { exec } = require('child_process');
          const script = `osascript -e 'try' -e 'set folderPath to POSIX path of (choose folder with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return folderPath' -e 'on error' -e 'return ""' -e 'end try'`;
          
          exec(script, (err, stdout) => {
            if (err || !stdout) {
              return sendJson(res, 200, { success: false, cancelled: true });
            }
            const selectedPath = stdout.trim().replace(/\/+$/, '');
            if (!selectedPath) {
              return sendJson(res, 200, { success: false, cancelled: true });
            }
            return sendJson(res, 200, { success: true, path: selectedPath });
          });
          return;
        } else {
          return sendJson(res, 200, { success: false, error: 'Platform not supported' });
        }
      }

      // POST or GET /api/browse-file (Native macOS Finder File Picker)
      if (pathname === '/api/browse-file' && (method === 'POST' || method === 'GET')) {
        let promptText = 'Chọn file script (.sh, .ts, .js, .py):';
        let defaultDir = '';
        try {
          if (method === 'POST') {
            const body = await getRequestBody(req);
            if (body && body.prompt) promptText = body.prompt;
            if (body && body.defaultDir) defaultDir = body.defaultDir;
          }
        } catch (e) {}

        if (process.platform === 'darwin') {
          const { exec } = require('child_process');
          let script = `osascript -e 'try' -e 'set filePath to POSIX path of (choose file with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return filePath' -e 'on error' -e 'return ""' -e 'end try'`;
          if (defaultDir && fs.existsSync(defaultDir)) {
            script = `osascript -e 'try' -e 'set defaultFolder to POSIX file "${defaultDir.replace(/"/g, '\\"')}"' -e 'set filePath to POSIX path of (choose file default location defaultFolder with prompt "${promptText.replace(/"/g, '\\"')}")' -e 'return filePath' -e 'on error' -e 'return ""' -e 'end try'`;
          }
          
          exec(script, (err, stdout) => {
            if (err || !stdout) {
              return sendJson(res, 200, { success: false, cancelled: true });
            }
            const selectedPath = stdout.trim();
            if (!selectedPath) {
              return sendJson(res, 200, { success: false, cancelled: true });
            }
            const filename = path.basename(selectedPath);
            const ext = path.extname(selectedPath).toLowerCase();
            let defaultRunner = 'bash';
            if (ext === '.js' || ext === '.mjs') defaultRunner = 'node';
            else if (ext === '.ts') defaultRunner = 'pnpm ts-node';
            else if (ext === '.py') defaultRunner = 'python3';
            else if (ext === '.sh') defaultRunner = 'bash';

            let relPath = selectedPath;
            if (defaultDir) {
              const rel = path.relative(defaultDir, selectedPath);
              relPath = rel.startsWith('.') ? rel : `./${rel}`;
            }

            return sendJson(res, 200, {
              success: true,
              path: selectedPath,
              filename,
              relativePath: relPath,
              ext,
              defaultRunner,
              suggestedCommand: `${defaultRunner} ${relPath}`
            });
          });
          return;
        } else {
          return sendJson(res, 200, { success: false, error: 'Platform not supported' });
        }
      }

      // POST /api/inspect-directory (Inspect folder for .env, .env.example, package.json)
      if (pathname === '/api/inspect-directory' && method === 'POST') {
        const body = await getRequestBody(req);
        const result = envManager.inspectDirectory(body.cwd || body.dirPath || body.path);
        return sendJson(res, 200, result);
      }

      // GET /api/categories (List all categories)
      if (pathname === '/api/categories' && method === 'GET') {
        const categories = envManager.getCategories();
        return sendJson(res, 200, { success: true, categories });
      }

      // POST /api/categories (Create category)
      if (pathname === '/api/categories' && method === 'POST') {
        const body = await getRequestBody(req);
        try {
          const categories = envManager.createCategory(body);
          return sendJson(res, 200, { success: true, categories });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // PUT /api/categories/:id (Update category)
      const catMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
      if (catMatch && method === 'PUT') {
        const catId = decodeURIComponent(catMatch[1]);
        const body = await getRequestBody(req);
        try {
          const categories = envManager.updateCategory(catId, body);
          return sendJson(res, 200, { success: true, categories });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // DELETE /api/categories/:id (Delete category)
      if (catMatch && method === 'DELETE') {
        const catId = decodeURIComponent(catMatch[1]);
        const body = await getRequestBody(req).catch(() => ({}));
        try {
          const categories = envManager.deleteCategory(catId, body.fallbackCategory || 'SERVICE');
          return sendJson(res, 200, { success: true, categories });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // POST /api/services/reset (Reset to default 6 services)
      if (pathname === '/api/services/reset' && method === 'POST') {
        const services = envManager.resetServicesToDefault();
        return sendJson(res, 200, { success: true, services });
      }

      // GET /api/export/all (Export all config as JSON)
      if (pathname === '/api/export/all' && method === 'GET') {
        const config = envManager.exportAllConfig();
        const dateStr = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="service-monitor-backup-${dateStr}.json"`
        });
        return res.end(JSON.stringify(config, null, 2));
      }

      // GET /api/services/:id/export (Export single service as JSON)
      const matchExportSingle = pathname.match(/^\/api\/services\/([^/]+)\/export$/);
      if (matchExportSingle && method === 'GET') {
        const serviceId = matchExportSingle[1];
        const config = envManager.exportServiceConfig(serviceId);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${serviceId}-config.json"`
        });
        return res.end(JSON.stringify(config, null, 2));
      }

      // POST /api/config/inspect (Preview & inspect import JSON)
      if (pathname === '/api/config/inspect' && method === 'POST') {
        try {
          const body = await getRequestBody(req);
          const inspection = envManager.inspectImportData(body.data || body);
          return sendJson(res, 200, { success: true, ...inspection });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // POST /api/import (Import JSON configuration)
      if (pathname === '/api/import' && method === 'POST') {
        try {
          const body = await getRequestBody(req);
          const result = envManager.importConfig(body.data || body, { mode: body.mode || 'merge' });
          return sendJson(res, 200, { success: true, ...result });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      // POST /api/services/:id/start
      const matchStart = pathname.match(/^\/api\/services\/([^/]+)\/start$/);
      if (matchStart && method === 'POST') {
        const serviceId = decodeURIComponent(matchStart[1]);
        const status = await processManager.startService(serviceId);
        return sendJson(res, 200, { success: true, status });
      }

      // POST /api/services/:id/stop
      const matchStop = pathname.match(/^\/api\/services\/([^/]+)\/stop$/);
      if (matchStop && method === 'POST') {
        const serviceId = decodeURIComponent(matchStop[1]);
        const status = await processManager.stopService(serviceId);
        return sendJson(res, 200, { success: true, status });
      }

      // POST /api/services/:id/restart
      const matchRestart = pathname.match(/^\/api\/services\/([^/]+)\/restart$/);
      if (matchRestart && method === 'POST') {
        const serviceId = decodeURIComponent(matchRestart[1]);
        const status = await processManager.restartService(serviceId);
        return sendJson(res, 200, { success: true, status });
      }

      // POST /api/services/:id/kill-port
      const matchKillPort = pathname.match(/^\/api\/services\/([^/]+)\/kill-port$/);
      if (matchKillPort && method === 'POST') {
        const serviceId = decodeURIComponent(matchKillPort[1]);
        const result = await processManager.killServicePort(serviceId);
        return sendJson(res, 200, { success: true, result });
      }

      // POST /api/services/:id/clear-logs
      const matchClear = pathname.match(/^\/api\/services\/([^/]+)\/clear-logs$/);
      if (matchClear && method === 'POST') {
        const serviceId = decodeURIComponent(matchClear[1]);
        processManager.clearLogs(serviceId);
        return sendJson(res, 200, { success: true });
      }

      // GET /api/services/:id/logs
      const matchLogs = pathname.match(/^\/api\/services\/([^/]+)\/logs$/);
      if (matchLogs && method === 'GET') {
        const serviceId = decodeURIComponent(matchLogs[1]);
        const logs = processManager.getLogBuffer(serviceId);
        return sendJson(res, 200, { success: true, logs });
      }

      // POST /api/services/:id/active-profile
      const matchProfile = pathname.match(/^\/api\/services\/([^/]+)\/active-profile$/);
      if (matchProfile && method === 'POST') {
        const serviceId = matchProfile[1];
        const body = await getRequestBody(req);
        if (!body.profile) {
          return sendJson(res, 400, { success: false, error: 'Profile is required' });
        }
        const updated = envManager.setActiveProfile(serviceId, body.profile);
        sendSseEvent('service-updated', updated);
        return sendJson(res, 200, { success: true, service: updated });
      }

      // POST /api/services/:id/env-overrides
      const matchOverrides = pathname.match(/^\/api\/services\/([^/]+)\/env-overrides$/);
      if (matchOverrides && method === 'POST') {
        const serviceId = matchOverrides[1];
        const body = await getRequestBody(req);
        const updated = envManager.setEnvOverrides(serviceId, body.overrides || {});
        sendSseEvent('service-updated', updated);
        return sendJson(res, 200, { success: true, service: updated });
      }

      // POST /api/services/:id/custom-profile
      const matchCustomProfile = pathname.match(/^\/api\/services\/([^/]+)\/custom-profile$/);
      if (matchCustomProfile && method === 'POST') {
        const serviceId = matchCustomProfile[1];
        const body = await getRequestBody(req);
        if (!body.profileKey || !body.profileData) {
          return sendJson(res, 400, { success: false, error: 'profileKey and profileData required' });
        }
        const updated = envManager.addCustomProfile(serviceId, body.profileKey, body.profileData);
        sendSseEvent('service-updated', updated);
        return sendJson(res, 200, { success: true, service: updated });
      }

      // DELETE /api/services/:id/custom-profile/:profileKey
      const matchDeleteProfile = pathname.match(/^\/api\/services\/([^/]+)\/custom-profile\/([^/]+)$/);
      if (matchDeleteProfile && (method === 'DELETE' || method === 'POST')) {
        const serviceId = matchDeleteProfile[1];
        const profileKey = matchDeleteProfile[2];
        const updated = envManager.deleteCustomProfile(serviceId, profileKey);
        sendSseEvent('service-updated', updated);
        return sendJson(res, 200, { success: true, service: updated });
      }

      // GET /api/global-env
      if (pathname === '/api/global-env' && method === 'GET') {
        const activeGlobalProfile = envManager.getActiveGlobalProfile();
        const globalProfiles = envManager.getGlobalProfiles();
        const globalEnv = envManager.getGlobalEnv(activeGlobalProfile);
        return sendJson(res, 200, { success: true, globalEnv, globalProfiles, activeGlobalProfile });
      }

      // POST /api/global-env
      if (pathname === '/api/global-env' && method === 'POST') {
        const body = await getRequestBody(req);
        const result = envManager.applyGlobalEnv(body.globalVars || {}, body.profileKey);
        return sendJson(res, 200, { success: true, ...result });
      }

      // POST /api/global-env/active-profile
      if (pathname === '/api/global-env/active-profile' && method === 'POST') {
        const body = await getRequestBody(req);
        const result = envManager.setActiveGlobalProfile(body.profile);
        return sendJson(res, 200, { success: true, ...result });
      }

      // POST /api/global-env/custom-profile
      if (pathname === '/api/global-env/custom-profile' && method === 'POST') {
        const body = await getRequestBody(req);
        const result = envManager.createGlobalCustomProfile(body.profileKey, body.profileData);
        if (result.services) {
          result.services.forEach(svc => sendSseEvent('service-updated', svc));
        }
        return sendJson(res, 200, { success: true, ...result });
      }

      // DELETE /api/global-env/custom-profile/:profileKey
      const matchDeleteGlobalProfile = pathname.match(/^\/api\/global-env\/custom-profile\/([^/]+)$/);
      if (matchDeleteGlobalProfile && method === 'DELETE') {
        const profileKey = matchDeleteGlobalProfile[1];
        const result = envManager.deleteGlobalCustomProfile(profileKey);
        return sendJson(res, 200, { success: true, ...result });
      }

      // POST /api/groups/:group/start
      const matchGroupStart = pathname.match(/^\/api\/groups\/([^/]+)\/start$/);
      if (matchGroupStart && method === 'POST') {
        const group = matchGroupStart[1].toUpperCase();
        const results = await processManager.startGroup(group);
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/groups/:group/stop
      const matchGroupStop = pathname.match(/^\/api\/groups\/([^/]+)\/stop$/);
      if (matchGroupStop && method === 'POST') {
        const group = matchGroupStop[1].toUpperCase();
        const results = await processManager.stopGroup(group);
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/groups/:group/restart
      const matchGroupRestart = pathname.match(/^\/api\/groups\/([^/]+)\/restart$/);
      if (matchGroupRestart && method === 'POST') {
        const group = matchGroupRestart[1].toUpperCase();
        const results = await processManager.restartGroup(group);
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/all/start
      if (pathname === '/api/all/start' && method === 'POST') {
        const results = await processManager.startAll();
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/all/stop
      if (pathname === '/api/all/stop' && method === 'POST') {
        const results = await processManager.stopAll();
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/all/restart
      if (pathname === '/api/all/restart' && method === 'POST') {
        const results = await processManager.restartAll();
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/all/kill-ports
      if (pathname === '/api/all/kill-ports' && method === 'POST') {
        const results = await processManager.killAllPorts();
        return sendJson(res, 200, { success: true, results });
      }

      // POST /api/all/active-profile
      if (pathname === '/api/all/active-profile' && method === 'POST') {
        const body = await getRequestBody(req);
        if (!body.profile) {
          return sendJson(res, 400, { success: false, error: 'Profile is required' });
        }
        const updatedServices = envManager.setAllActiveProfile(body.profile);
        for (const s of updatedServices) {
          sendSseEvent('service-updated', s);
        }
        return sendJson(res, 200, { success: true, services: updatedServices });
      }

      // ================= GLOBAL SCRIPTS ROUTES =================
      // GET /api/scripts
      if (pathname === '/api/scripts' && method === 'GET') {
        const scripts = envManager.getGlobalScripts();
        const rootDir = envManager.userConfig.workspaceRoot || ROOT_DIR;
        const scannedFiles = envManager.scanDirectoryScripts(rootDir);
        return sendJson(res, 200, { success: true, scripts, scannedFiles, workspaceRoot: rootDir });
      }

      // POST /api/scripts
      if (pathname === '/api/scripts' && method === 'POST') {
        const body = await getRequestBody(req);
        if (!body.command) {
          return sendJson(res, 400, { success: false, error: 'Command is required' });
        }
        const created = envManager.addGlobalScript(body);
        return sendJson(res, 200, { success: true, script: created, scripts: envManager.getGlobalScripts() });
      }

      // DELETE /api/scripts/:id
      const matchDeleteGlobalScript = pathname.match(/^\/api\/scripts\/([^/]+)$/);
      if (matchDeleteGlobalScript && (method === 'DELETE' || method === 'POST')) {
        const scriptId = decodeURIComponent(matchDeleteGlobalScript[1]);
        const result = envManager.deleteGlobalScript(scriptId);
        return sendJson(res, 200, { success: true, ...result, scripts: envManager.getGlobalScripts() });
      }

      // POST /api/scripts/:id/run
      const matchRunGlobalScript = pathname.match(/^\/api\/scripts\/([^/]+)\/run$/);
      if (matchRunGlobalScript && method === 'POST') {
        const scriptId = decodeURIComponent(matchRunGlobalScript[1]);
        const scripts = envManager.getGlobalScripts();
        const found = scripts.find(s => s.id === scriptId);
        const body = (await getRequestBody(req)) || {};
        const scriptConfig = found || body;
        
        taskRunner.runGlobalScript(scriptConfig).catch(err => {
          console.error(`Global script ${scriptId} failed:`, err);
        });
        return sendJson(res, 200, { success: true, message: `Script ${scriptConfig.name || scriptId} started` });
      }

      // POST /api/scripts/inspect-env
      if (pathname === '/api/scripts/inspect-env' && method === 'POST') {
        const body = (await getRequestBody(req)) || {};
        const detected = envManager.detectScriptEnv(body.cwd, body.cwdType);
        return sendJson(res, 200, { success: true, ...detected });
      }

      // GET /api/services/:id/scripts
      const matchGetScripts = pathname.match(/^\/api\/services\/([^/]+)\/scripts$/);
      if (matchGetScripts && method === 'GET') {
        const serviceId = decodeURIComponent(matchGetScripts[1]);
        const svc = envManager.getServiceById(serviceId);
        const scripts = envManager.getServiceScripts(serviceId);
        const scannedFiles = svc && svc.cwd ? envManager.scanDirectoryScripts(svc.cwd) : [];
        return sendJson(res, 200, { success: true, scripts, scannedFiles });
      }

      // POST /api/services/:id/scripts
      const matchAddScript = pathname.match(/^\/api\/services\/([^/]+)\/scripts$/);
      if (matchAddScript && method === 'POST') {
        const serviceId = decodeURIComponent(matchAddScript[1]);
        const body = await getRequestBody(req);
        if (!body.command) {
          return sendJson(res, 400, { success: false, error: 'Command is required' });
        }
        const created = envManager.addServiceScript(serviceId, body);
        const updatedSvc = envManager.getServiceById(serviceId);
        sendSseEvent('service-updated', updatedSvc);
        return sendJson(res, 200, { success: true, script: created, service: updatedSvc });
      }

      // DELETE /api/services/:id/scripts/:scriptId
      const matchDeleteScript = pathname.match(/^\/api\/services\/([^/]+)\/scripts\/([^/]+)$/);
      if (matchDeleteScript && (method === 'DELETE' || method === 'POST')) {
        const serviceId = decodeURIComponent(matchDeleteScript[1]);
        const scriptId = decodeURIComponent(matchDeleteScript[2]);
        const result = envManager.deleteServiceScript(serviceId, scriptId);
        const updatedSvc = envManager.getServiceById(serviceId);
        sendSseEvent('service-updated', updatedSvc);
        return sendJson(res, 200, { success: true, ...result, service: updatedSvc });
      }

      // POST /api/services/:id/run-custom-script
      const matchRunCustomScript = pathname.match(/^\/api\/services\/([^/]+)\/run-custom-script$/);
      if (matchRunCustomScript && method === 'POST') {
        const serviceId = decodeURIComponent(matchRunCustomScript[1]);
        const body = await getRequestBody(req);
        taskRunner.runCustomScript(serviceId, body).catch(err => {
          console.error(`Custom script for ${serviceId} failed:`, err);
        });
        return sendJson(res, 200, { success: true, message: `Script started for ${serviceId}` });
      }

      // POST /api/services/:id/task/:taskType
      const matchServiceTask = pathname.match(/^\/api\/services\/([^/]+)\/task\/([^/]+)$/);
      if (matchServiceTask && method === 'POST') {
        const serviceId = decodeURIComponent(matchServiceTask[1]);
        const taskType = matchServiceTask[2];
        taskRunner.runServiceTask(serviceId, taskType).catch(err => {
          console.error(`Service Task ${taskType} for ${serviceId} failed:`, err);
        });
        return sendJson(res, 200, { success: true, message: `Task ${taskType} started for ${serviceId}` });
      }

      // POST /api/tasks/:taskType
      const matchTask = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (matchTask && method === 'POST') {
        const taskType = matchTask[1];
        taskRunner.runTask(taskType).catch(err => {
          console.error(`Task ${taskType} failed:`, err);
        });
        return sendJson(res, 200, { success: true, message: `Task ${taskType} started` });
      }

      // GET /api/paths
      if (pathname === '/api/paths' && method === 'GET') {
        const config = envManager.getPathsConfig();
        return sendJson(res, 200, { success: true, config });
      }

      // POST /api/paths
      if (pathname === '/api/paths' && method === 'POST') {
        const body = await getRequestBody(req);
        const config = envManager.updatePathsConfig(body);
        const services = envManager.getServices();
        for (const s of services) {
          sendSseEvent('service-updated', s);
        }
        return sendJson(res, 200, { success: true, config, services });
      }

      // POST /api/paths/reset
      if (pathname === '/api/paths/reset' && method === 'POST') {
        const config = envManager.resetPathsConfig();
        const services = envManager.getServices();
        for (const s of services) {
          sendSseEvent('service-updated', s);
        }
        return sendJson(res, 200, { success: true, config, services });
      }

      // POST /api/services/:id/export-env
      const matchExportEnv = pathname.match(/^\/api\/services\/([^/]+)\/export-env$/);
      if (matchExportEnv && method === 'POST') {
        const serviceId = matchExportEnv[1];
        const result = envManager.exportServiceEnvToFile(serviceId);
        return sendJson(res, 200, { success: true, result });
      }

      return sendJson(res, 404, { success: false, error: 'Endpoint not found' });
    } catch (err) {
      console.error('[API Error]:', err);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // Static file serving (dist/index.html)
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Dashboard UI index.html not found');
  }
});

// Clean shutdown
process.on('SIGINT', async () => {
  console.log('\n[Dashboard] Đang dừng toàn bộ services trước khi tắt server...');
  await processManager.stopAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await processManager.stopAll();
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Service Monitor Dashboard đang chạy tại: http://localhost:${PORT}`);
  console.log(`👉 Mở trình duyệt để quản lý services và env profiles.\n`);
});
