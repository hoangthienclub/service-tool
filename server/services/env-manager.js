const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../../../');
const PROTECTED_PROFILES = [];
const DEFAULT_SERVICES = [];
const DEFAULT_TEMPLATES = [];

const DATA_DIR = path.resolve(__dirname, '../../data');
const PROFILES_FILE = path.join(DATA_DIR, 'user-profiles.json');

class EnvManager {
  constructor() {
    this.ensureDataDir();
    this.userConfig = this.loadUserConfig();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadUserConfig() {
    try {
      if (fs.existsSync(PROFILES_FILE)) {
        const raw = fs.readFileSync(PROFILES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          workspaceRoot: parsed.workspaceRoot || ROOT_DIR,
          customServicePaths: parsed.customServicePaths || {},
          activeProfiles: parsed.activeProfiles || {},
          customProfiles: parsed.customProfiles || {},
          customEnvOverrides: parsed.customEnvOverrides || {},
          customServices: Array.isArray(parsed.customServices) ? parsed.customServices : null,
          customCategories: Array.isArray(parsed.customCategories) ? parsed.customCategories : null,
          customScripts: parsed.customScripts || {},
          globalScripts: Array.isArray(parsed.globalScripts) ? parsed.globalScripts : [],
          globalProfiles: parsed.globalProfiles || (parsed.globalEnv ? { default: { env: parsed.globalEnv } } : { default: { env: {} } }),
          activeGlobalProfile: parsed.activeGlobalProfile || 'default'
        };
      }
    } catch (err) {
      console.error('[EnvManager] Error loading user profiles:', err);
    }
    return {
      workspaceRoot: ROOT_DIR,
      customServicePaths: {},
      activeProfiles: {},
      customProfiles: {},
      customEnvOverrides: {},
      customServices: null,
      customCategories: null,
      customScripts: {},
      globalScripts: [],
      globalProfiles: { default: { env: {} } },
      activeGlobalProfile: 'default'
    };
  }

  saveUserConfig() {
    try {
      this.ensureDataDir();
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(this.userConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('[EnvManager] Error saving user profiles:', err);
    }
  }

  // ================= CATEGORY MANAGEMENT =================
  getCategories() {
    const services = this.getServices();
    let baseCategories = this.userConfig.customCategories;

    if (!baseCategories || !Array.isArray(baseCategories)) {
      const distinctGroups = Array.from(new Set(services.map(s => (s.group || s.category || 'SERVICE').toUpperCase())));
      baseCategories = distinctGroups.map(grp => ({
        id: grp,
        name: grp,
        description: `Nhóm ${grp}`,
        color: '#38bdf8',
        icon: grp === 'FE' ? '🖥️' : grp === 'BFF' ? '⚡' : grp === 'GATEWAY' ? '🚪' : '⚙️'
      }));
    }

    return baseCategories.map(cat => {
      const catId = (cat.id || cat.name || '').toUpperCase();
      const matchingServices = services.filter(s => (s.group || s.category || '').toUpperCase() === catId);
      return {
        ...cat,
        id: catId,
        name: cat.name || catId,
        serviceCount: matchingServices.length,
        services: matchingServices.map(s => ({ id: s.id, name: s.name, port: s.port }))
      };
    });
  }

  createCategory(categoryData) {
    if (!categoryData.id && !categoryData.name) {
      throw new Error('Tên danh mục không được để trống!');
    }
    const id = (categoryData.id || categoryData.name).trim().toUpperCase().replace(/\s+/g, '_');
    const existing = this.getCategories();
    if (existing.some(c => c.id === id)) {
      throw new Error(`Danh mục '${id}' đã tồn tại!`);
    }

    const newCat = {
      id,
      name: (categoryData.name || id).trim(),
      description: categoryData.description || `Nhóm ${id}`,
      color: categoryData.color || '#38bdf8',
      icon: categoryData.icon || '📁'
    };

    const currentList = this.userConfig.customCategories || existing.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color,
      icon: c.icon
    }));

    this.userConfig.customCategories = [...currentList, newCat];
    this.saveUserConfig();
    return this.getCategories();
  }

  updateCategory(categoryId, categoryData) {
    const id = categoryId.trim().toUpperCase();
    const existing = this.getCategories();
    const index = existing.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error(`Không tìm thấy danh mục: ${id}`);
    }

    const newId = (categoryData.id || id).trim().toUpperCase().replace(/\s+/g, '_');
    const updatedName = (categoryData.name || newId).trim();

    if (newId !== id) {
      const services = this.getRawServicesList();
      let changed = false;
      const updatedServices = services.map(s => {
        if ((s.group || s.category || '').toUpperCase() === id) {
          changed = true;
          return { ...s, group: newId, category: newId };
        }
        return s;
      });
      if (changed) {
        this.userConfig.customServices = updatedServices;
      }
    }

    const currentList = this.userConfig.customCategories || existing.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      color: c.color,
      icon: c.icon
    }));

    const catIdx = currentList.findIndex(c => c.id === id);
    const updatedCat = {
      id: newId,
      name: updatedName,
      description: categoryData.description !== undefined ? categoryData.description : currentList[catIdx]?.description,
      color: categoryData.color || currentList[catIdx]?.color || '#38bdf8',
      icon: categoryData.icon || currentList[catIdx]?.icon || '📁'
    };

    if (catIdx >= 0) {
      currentList[catIdx] = updatedCat;
      this.userConfig.customCategories = currentList;
    } else {
      this.userConfig.customCategories = [...currentList, updatedCat];
    }

    this.saveUserConfig();
    return this.getCategories();
  }

  deleteCategory(categoryId, fallbackCategory = 'SERVICE') {
    const id = categoryId.trim().toUpperCase();
    const existing = this.getCategories();
    const filtered = (this.userConfig.customCategories || existing).filter(c => c.id !== id);
    this.userConfig.customCategories = filtered;

    const services = this.getRawServicesList();
    let changed = false;
    const updatedServices = services.map(s => {
      if ((s.group || s.category || '').toUpperCase() === id) {
        changed = true;
        return { ...s, group: fallbackCategory, category: fallbackCategory };
      }
      return s;
    });
    if (changed) {
      this.userConfig.customServices = updatedServices;
    }

    this.saveUserConfig();
    return this.getCategories();
  }

  getTemplates() {
    return DEFAULT_TEMPLATES;
  }

  getRawServicesList() {
    if (this.userConfig.customServices && Array.isArray(this.userConfig.customServices)) {
      return this.userConfig.customServices;
    }
    return DEFAULT_SERVICES;
  }

  getServices() {
    const root = this.userConfig.workspaceRoot || ROOT_DIR;
    const customPaths = this.userConfig.customServicePaths || {};
    const baseList = this.getRawServicesList();

    return baseList.map(svc => {
      const customProfiles = this.userConfig.customProfiles[svc.id] || {};
      const allProfiles = { ...(svc.profiles || {}), ...customProfiles };
      const activeProfileKey = this.userConfig.activeProfiles[svc.id] || svc.defaultProfile || Object.keys(allProfiles)[0] || 'default';
      
      const currentProfile = allProfiles[activeProfileKey] || (Object.values(allProfiles)[0]) || { env: {} };
      
      // Calculate dynamic CWD
      const effectiveCwd = customPaths[svc.id] || (svc.relativeDir ? path.resolve(root, svc.relativeDir) : svc.cwd || root);
      const cwdExists = fs.existsSync(effectiveCwd);

      // Get overrides specific to this service and profile
      const serviceOverrides = this.userConfig.customEnvOverrides[svc.id] || {};
      const profileOverrides = serviceOverrides[activeProfileKey] || {};

      // Merge environment variables: Profile Env + User Overrides
      const computedEnv = {
        ...(currentProfile.env || {}),
        ...profileOverrides
      };

      // Compute dynamic port from active profile computedEnv or svc.port
      let dynamicPort = null;
      const isSocket = (svc.name || '').toLowerCase().includes('socket') || (svc.id || '').toLowerCase().includes('socket');
      const isWorker = (svc.name || '').toLowerCase().includes('consumer') || 
                       (svc.name || '').toLowerCase().includes('worker') || 
                       (svc.id || '').toLowerCase().includes('consumer') || 
                       (svc.id || '').toLowerCase().includes('worker') || 
                       (svc.args || []).some(a => String(a).includes('consumer') || String(a).includes('worker'));

      const portCandidates = [
        isSocket ? 'NEST_SOCKET_PORT' : null,
        isSocket ? 'SOCKET_PORT' : null,
        isSocket ? 'WS_PORT' : null,
        'NEST_API_PORT',
        'PORT',
        'HTTP_PORT',
        'APP_PORT',
        'SERVER_PORT',
        'NEST_SOCKET_PORT',
        'API_PORT',
        'VITE_PORT',
        'PORT_HTTP',
        'GRPC_PORT',
        'SERVICE_PORT'
      ].filter(Boolean);

      for (const k of portCandidates) {
        if (computedEnv[k]) {
          const p = parseInt(computedEnv[k], 10);
          if (!isNaN(p) && p > 0) {
            dynamicPort = p;
            break;
          }
        }
      }

      // Check vite.config or frontend config if not found in env
      if (!dynamicPort && !isWorker && effectiveCwd && fs.existsSync(effectiveCwd)) {
        const viteFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
        for (const vf of viteFiles) {
          const vPath = path.join(effectiveCwd, vf);
          if (fs.existsSync(vPath)) {
            try {
              const vContent = fs.readFileSync(vPath, 'utf8');
              const match = vContent.match(/port\s*:\s*(\d+)/);
              if (match && match[1]) {
                dynamicPort = parseInt(match[1], 10);
                break;
              } else {
                dynamicPort = 5173;
                break;
              }
            } catch (e) {}
          }
        }
      }

      if (!dynamicPort && !isWorker && svc.port) {
        const p = parseInt(svc.port, 10);
        if (!isNaN(p) && p > 0 && p !== 8080) {
          dynamicPort = p;
        }
      }

      if (isWorker) {
        dynamicPort = null;
      }

      return {
        id: svc.id,
        name: svc.name,
        category: svc.category || 'SERVICE',
        group: svc.group || svc.category || 'SERVICE',
        port: dynamicPort,
        script: svc.script,
        args: svc.args || [],
        relativeDir: svc.relativeDir || '',
        cwd: effectiveCwd,
        cwdExists,
        defaultProfile: svc.defaultProfile || 'local',
        activeProfile: activeProfileKey,
        profiles: allProfiles,
        computedEnv,
        customScripts: this.getServiceScripts(svc.id),
        isCustom: !!svc.isCustom
      };
    });
  }

  getServiceById(id) {
    const services = this.getServices();
    return services.find(s => s.id === id);
  }

  // ================= DYNAMIC SERVICE CRUD =================
  parseEnvContent(content) {
    const result = {};
    if (!content || typeof content !== 'string') return result;
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
    }
    return result;
  }

  inspectDirectory(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      return { success: false, error: 'Đường dẫn không hợp lệ', exists: false };
    }
    const targetDir = path.resolve(dirPath.trim());
    if (!fs.existsSync(targetDir)) {
      return { success: false, error: 'Thư mục không tồn tại', exists: false, dirPath: targetDir };
    }

    let parsedEnv = {};
    let envSource = null;

    const envCandidates = ['.env', '.env.local', '.env.example', '.env.sample', '.env.dist'];
    for (const file of envCandidates) {
      const fullPath = path.join(targetDir, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          parsedEnv = this.parseEnvContent(content);
          envSource = file;
          break;
        } catch (e) {
          console.error(`Error reading ${fullPath}:`, e);
        }
      }
    }

    let packageInfo = null;
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        let pkgManager = 'npm';
        if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) {
          pkgManager = 'yarn';
        } else if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) {
          pkgManager = 'pnpm';
        } else if (fs.existsSync(path.join(targetDir, 'bun.lockb')) || fs.existsSync(path.join(targetDir, 'bun.lock'))) {
          pkgManager = 'bun';
        }

        const scripts = pkg.scripts || {};
        const scriptKeys = Object.keys(scripts);
        
        // Priority order for dev/start scripts
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
            script: pkgManager,
            args: bestArgs,
            display: `${pkgManager} ${bestArgs}`
          };
        }

        packageInfo = {
          name: pkg.name || '',
          pkgManager,
          bestScript,
          scripts: scriptSuggestions
        };
      } catch (e) {
        console.error(`Error parsing ${pkgPath}:`, e);
      }
    }

    return {
      success: true,
      exists: true,
      dirPath: targetDir,
      envSource,
      env: parsedEnv,
      envCount: Object.keys(parsedEnv).length,
      packageInfo
    };
  }

  createService(serviceData) {
    if (!serviceData.name || !serviceData.name.trim()) {
      throw new Error('Tên Service không được để trống!');
    }
    if (!serviceData.id || !serviceData.id.trim()) {
      throw new Error('Service ID không được để trống!');
    }

    const id = serviceData.id.trim().toLowerCase().replace(/\s+/g, '-');
    const existingList = this.getRawServicesList();
    if (existingList.some(s => s.id === id)) {
      throw new Error(`Service với ID '${id}' đã tồn tại!`);
    }

    // Auto-read .env / .env.example if cwd provided and defaultEnv is not explicitly passed
    let initialEnv = serviceData.defaultEnv;
    let detectedPort = serviceData.port !== undefined && serviceData.port !== null && serviceData.port !== '' ? parseInt(serviceData.port, 10) : null;

    if (!initialEnv || Object.keys(initialEnv).length === 0) {
      if (serviceData.cwd) {
        const inspected = this.inspectDirectory(serviceData.cwd);
        if (inspected.success && inspected.env && Object.keys(inspected.env).length > 0) {
          initialEnv = inspected.env;
        }
      }
    }

    if (initialEnv) {
      const isSocket = (serviceData.name || '').toLowerCase().includes('socket') || (id || '').toLowerCase().includes('socket');
      const isWorker = (serviceData.name || '').toLowerCase().includes('consumer') || 
                       (serviceData.name || '').toLowerCase().includes('worker') || 
                       (id || '').toLowerCase().includes('consumer') || 
                       (id || '').toLowerCase().includes('worker') || 
                       (serviceData.args || []).some(a => String(a).includes('consumer') || String(a).includes('worker'));

      if (!isWorker && !detectedPort) {
        const portCandidates = [
          isSocket ? 'NEST_SOCKET_PORT' : null,
          isSocket ? 'SOCKET_PORT' : null,
          isSocket ? 'WS_PORT' : null,
          'NEST_API_PORT',
          'PORT',
          'HTTP_PORT',
          'APP_PORT',
          'SERVER_PORT',
          'NEST_SOCKET_PORT',
          'API_PORT',
          'VITE_PORT',
          'PORT_HTTP',
          'GRPC_PORT'
        ].filter(Boolean);

        for (const k of portCandidates) {
          if (initialEnv[k]) {
            const p = parseInt(initialEnv[k], 10);
            if (!isNaN(p) && p > 0) {
              detectedPort = p;
              break;
            }
          }
        }
      }
    }

    if (!initialEnv) {
      initialEnv = {};
    }

    const newService = {
      id,
      name: serviceData.name.trim(),
      category: (serviceData.category || 'SERVICE').toUpperCase(),
      group: (serviceData.group || serviceData.category || 'SERVICE').toUpperCase(),
      port: detectedPort,
      script: serviceData.script || 'npm',
      args: Array.isArray(serviceData.args) ? serviceData.args : (serviceData.args ? serviceData.args.split(' ') : ['run', 'dev']),
      cwd: serviceData.cwd || serviceData.relativeDir || '',
      relativeDir: serviceData.relativeDir || '',
      defaultProfile: serviceData.defaultProfile || 'default',
      isCustom: true,
      profiles: serviceData.profiles || {
        default: {
          name: 'Default Environment',
          description: 'Môi trường mặc định',
          env: initialEnv
        }
      }
    };

    if (serviceData.cwd) {
      if (!this.userConfig.customServicePaths) this.userConfig.customServicePaths = {};
      this.userConfig.customServicePaths[id] = serviceData.cwd;
    }

    const currentServices = [...existingList, newService];
    this.userConfig.customServices = currentServices;
    this.userConfig.activeProfiles[id] = 'default';
    this.saveUserConfig();

    return this.getServiceById(id);
  }

  updateService(serviceId, serviceData) {
    const currentList = this.getRawServicesList();
    const index = currentList.findIndex(s => s.id === serviceId);
    if (index === -1) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const current = currentList[index];
    const updated = {
      ...current,
      name: serviceData.name !== undefined ? serviceData.name.trim() : current.name,
      category: serviceData.category ? serviceData.category.toUpperCase() : current.category,
      group: (serviceData.group || serviceData.category || current.group).toUpperCase(),
      port: serviceData.port !== undefined ? parseInt(serviceData.port, 10) : current.port,
      script: serviceData.script !== undefined ? serviceData.script : current.script,
      args: serviceData.args !== undefined 
        ? (Array.isArray(serviceData.args) ? serviceData.args : serviceData.args.split(' ')) 
        : current.args,
      cwd: serviceData.cwd !== undefined ? serviceData.cwd : (current.cwd || current.relativeDir || ''),
      relativeDir: serviceData.relativeDir !== undefined ? serviceData.relativeDir : current.relativeDir
    };

    if (serviceData.cwd !== undefined) {
      if (!this.userConfig.customServicePaths) this.userConfig.customServicePaths = {};
      this.userConfig.customServicePaths[serviceId] = serviceData.cwd;
    }

    if (serviceData.profiles) {
      updated.profiles = { ...updated.profiles, ...serviceData.profiles };
    }

    const newList = [...currentList];
    newList[index] = updated;
    this.userConfig.customServices = newList;
    this.saveUserConfig();

    return this.getServiceById(serviceId);
  }

  deleteService(serviceId) {
    const currentList = this.getRawServicesList();
    const filtered = currentList.filter(s => s.id !== serviceId);
    if (filtered.length === currentList.length) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    this.userConfig.customServices = filtered;
    delete this.userConfig.activeProfiles[serviceId];
    delete this.userConfig.customProfiles[serviceId];
    delete this.userConfig.customEnvOverrides[serviceId];
    delete this.userConfig.customServicePaths[serviceId];
    this.saveUserConfig();

    return { success: true, serviceId };
  }

  resetServicesToDefault() {
    this.userConfig.customServices = null;
    this.saveUserConfig();
    return this.getServices();
  }

  // ================= IMPORT & EXPORT ENGINE =================
  exportAllConfig() {
    const rawServices = this.getRawServicesList();
    return {
      version: '1.0.0',
      workspaceRoot: this.userConfig.workspaceRoot || ROOT_DIR,
      exportedAt: new Date().toISOString(),
      services: rawServices.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category || 'SERVICE',
        group: s.group || s.category || 'SERVICE',
        port: s.port,
        script: s.script,
        args: s.args,
        relativeDir: s.relativeDir,
        defaultProfile: s.defaultProfile || 'local',
        profiles: s.profiles || {}
      })),
      activeProfiles: this.userConfig.activeProfiles,
      customProfiles: this.userConfig.customProfiles,
      customEnvOverrides: this.userConfig.customEnvOverrides,
      customServicePaths: this.userConfig.customServicePaths
    };
  }

  exportServiceConfig(serviceId) {
    const svc = this.getServiceById(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      service: {
        id: svc.id,
        name: svc.name,
        category: svc.category,
        group: svc.group,
        port: svc.port,
        script: svc.script,
        args: svc.args,
        relativeDir: svc.relativeDir,
        defaultProfile: svc.defaultProfile,
        profiles: svc.profiles,
        activeProfile: svc.activeProfile,
        computedEnv: svc.computedEnv
      }
    };
  }

  importConfig(importData, options = { mode: 'merge' }) {
    if (!importData || typeof importData !== 'object') {
      throw new Error('Dữ liệu Import không hợp lệ (cần file JSON hợp lệ)!');
    }

    // Support single service import or all config import
    const incomingServices = Array.isArray(importData.services) 
      ? importData.services 
      : (importData.service ? [importData.service] : []);

    if (incomingServices.length === 0) {
      throw new Error('Không tìm thấy định nghĩa service nào trong file import!');
    }

    // Validate incoming services
    for (const s of incomingServices) {
      if (!s.id || !s.name) {
        throw new Error(`Service không hợp lệ trong file import: thiếu 'id' hoặc 'name'!`);
      }
    }

    const mode = options.mode || 'merge';

    if (mode === 'overwrite') {
      this.userConfig.customServices = incomingServices;
      if (importData.activeProfiles) this.userConfig.activeProfiles = importData.activeProfiles;
      if (importData.customProfiles) this.userConfig.customProfiles = importData.customProfiles;
      if (importData.customEnvOverrides) this.userConfig.customEnvOverrides = importData.customEnvOverrides;
      if (importData.customServicePaths) this.userConfig.customServicePaths = importData.customServicePaths;
      if (importData.workspaceRoot) this.userConfig.workspaceRoot = importData.workspaceRoot;
    } else {
      // Merge mode
      const currentList = [...this.getRawServicesList()];
      for (const inc of incomingServices) {
        const idx = currentList.findIndex(s => s.id === inc.id);
        if (idx >= 0) {
          currentList[idx] = { ...currentList[idx], ...inc };
        } else {
          currentList.push(inc);
        }
      }
      this.userConfig.customServices = currentList;

      if (importData.activeProfiles) {
        this.userConfig.activeProfiles = { ...this.userConfig.activeProfiles, ...importData.activeProfiles };
      }
      if (importData.customProfiles) {
        this.userConfig.customProfiles = { ...this.userConfig.customProfiles, ...importData.customProfiles };
      }
      if (importData.customEnvOverrides) {
        this.userConfig.customEnvOverrides = { ...this.userConfig.customEnvOverrides, ...importData.customEnvOverrides };
      }
    }

    this.saveUserConfig();
    return {
      success: true,
      mode,
      importedCount: incomingServices.length,
      services: this.getServices()
    };
  }

  // ================= PATHS CONFIGURATION =================
  getPathsConfig() {
    const root = this.userConfig.workspaceRoot || ROOT_DIR;
    const customPaths = this.userConfig.customServicePaths || {};
    const services = this.getServices();

    const list = services.map(s => ({
      id: s.id,
      name: s.name,
      group: s.group || s.category || 'SERVICE',
      relativeDir: s.relativeDir || '',
      cwd: s.cwd,
      currentCwd: s.cwd,
      exists: s.cwdExists,
      isCustom: !!customPaths[s.id]
    }));

    const rootExists = fs.existsSync(root);

    return {
      workspaceRoot: root,
      workspaceRootExists: rootExists,
      rootExists,
      services: list,
      servicePaths: list
    };
  }

  updatePathsConfig({ workspaceRoot, customServicePaths }) {
    if (workspaceRoot && typeof workspaceRoot === 'string') {
      this.userConfig.workspaceRoot = path.resolve(workspaceRoot.trim());
    }
    if (customServicePaths && typeof customServicePaths === 'object') {
      this.userConfig.customServicePaths = {
        ...(this.userConfig.customServicePaths || {}),
        ...customServicePaths
      };
    }
    this.saveUserConfig();
    return this.getPathsConfig();
  }

  resetPathsConfig() {
    this.userConfig.workspaceRoot = ROOT_DIR;
    this.userConfig.customServicePaths = {};
    this.saveUserConfig();
    return this.getPathsConfig();
  }

  // ================= EXPORT .ENV FILE =================
  exportServiceEnvToFile(serviceId) {
    const svc = this.getServiceById(serviceId);
    if (!svc) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    if (!fs.existsSync(svc.cwd)) {
      throw new Error(`Thư mục service không tồn tại: ${svc.cwd}`);
    }

    const envFilePath = path.join(svc.cwd, '.env');
    const computedEnv = svc.computedEnv || {};
    
    let content = `# Generated by Service Monitor Dashboard (Profile: ${svc.activeProfile})\n`;
    content += `# Exported at: ${new Date().toISOString()}\n\n`;

    for (const [k, v] of Object.entries(computedEnv)) {
      content += `${k}=${v}\n`;
    }

    fs.writeFileSync(envFilePath, content, 'utf8');
    return {
      success: true,
      serviceId,
      profile: svc.activeProfile,
      filePath: envFilePath,
      keysCount: Object.keys(computedEnv).length
    };
  }

  // ================= PROFILE & ENV METHODS =================
  setActiveProfile(serviceId, profileKey) {
    this.userConfig.activeProfiles[serviceId] = profileKey;
    this.saveUserConfig();
    return this.getServiceById(serviceId);
  }

  setAllActiveProfile(profileKey) {
    const services = this.getServices();
    for (const svc of services) {
      this.userConfig.activeProfiles[svc.id] = profileKey;
    }
    this.saveUserConfig();
    return this.getServices();
  }

  setEnvOverrides(serviceId, overrides) {
    const activeProfileKey = this.userConfig.activeProfiles[serviceId] || 'local';
    
    if (!this.userConfig.customEnvOverrides[serviceId]) {
      this.userConfig.customEnvOverrides[serviceId] = {};
    }

    if (typeof this.userConfig.customEnvOverrides[serviceId] !== 'object' || 
        Array.isArray(this.userConfig.customEnvOverrides[serviceId])) {
      this.userConfig.customEnvOverrides[serviceId] = {};
    }

    this.userConfig.customEnvOverrides[serviceId][activeProfileKey] = overrides;

    if (this.userConfig.customProfiles[serviceId]?.[activeProfileKey]) {
      this.userConfig.customProfiles[serviceId][activeProfileKey].env = overrides;
    }

    this.saveUserConfig();
    return this.getServiceById(serviceId);
  }

  addCustomProfile(serviceId, profileKey, profileData = {}) {
    const key = profileKey.trim();
    if (!key) throw new Error('Tên profile không được để trống!');

    if (!this.userConfig.customProfiles[serviceId]) {
      this.userConfig.customProfiles[serviceId] = {};
    }
    this.userConfig.customProfiles[serviceId][key] = {
      name: profileData.name || key,
      description: profileData.description || `Profile ${key}`,
      env: profileData.env || {}
    };

    const currentList = this.getRawServicesList();
    const svc = currentList.find(s => s.id === serviceId);
    if (svc) {
      if (!svc.profiles) svc.profiles = {};
      svc.profiles[key] = {
        name: profileData.name || key,
        description: profileData.description || `Profile ${key}`,
        env: profileData.env || {}
      };
    }

    this.userConfig.activeProfiles[serviceId] = key;
    
    if (!this.userConfig.customEnvOverrides[serviceId]) {
      this.userConfig.customEnvOverrides[serviceId] = {};
    }
    this.userConfig.customEnvOverrides[serviceId][key] = profileData.env || {};

    this.saveUserConfig();
    return this.getServiceById(serviceId);
  }

  deleteCustomProfile(serviceId, profileKey) {
    const key = (profileKey || '').trim();
    const currentList = this.getRawServicesList();
    const svc = currentList.find(s => s.id === serviceId);

    if (this.userConfig.customProfiles[serviceId]) {
      delete this.userConfig.customProfiles[serviceId][key];
      delete this.userConfig.customProfiles[serviceId][key.toLowerCase()];
    }

    if (svc && svc.profiles) {
      delete svc.profiles[key];
      delete svc.profiles[key.toLowerCase()];
    }

    if (this.userConfig.customEnvOverrides[serviceId]) {
      delete this.userConfig.customEnvOverrides[serviceId][key];
      delete this.userConfig.customEnvOverrides[serviceId][key.toLowerCase()];
    }

    const remainingProfiles = Object.keys({
      ...(svc?.profiles || {}),
      ...(this.userConfig.customProfiles[serviceId] || {})
    });

    if (this.userConfig.activeProfiles[serviceId] === key || 
        this.userConfig.activeProfiles[serviceId] === key.toLowerCase() || 
        !remainingProfiles.includes(this.userConfig.activeProfiles[serviceId])) {
      this.userConfig.activeProfiles[serviceId] = remainingProfiles[0] || '';
    }

    this.saveUserConfig();
    return this.getServiceById(serviceId);
  }

  getGlobalProfiles() {
    if (!this.userConfig.globalProfiles || typeof this.userConfig.globalProfiles !== 'object') {
      this.userConfig.globalProfiles = { default: { env: {} } };
    }
    if (!this.userConfig.globalProfiles.default) {
      this.userConfig.globalProfiles.default = { env: {} };
    }
    return this.userConfig.globalProfiles;
  }

  getActiveGlobalProfile() {
    return this.userConfig.activeGlobalProfile || 'default';
  }

  setActiveGlobalProfile(profileKey) {
    const key = (profileKey || 'default').toLowerCase();
    this.userConfig.activeGlobalProfile = key;
    if (!this.userConfig.globalProfiles) {
      this.userConfig.globalProfiles = { default: { env: {} } };
    }
    if (!this.userConfig.globalProfiles[key]) {
      this.userConfig.globalProfiles[key] = { env: {} };
    }
    this.saveUserConfig();
    return {
      activeGlobalProfile: this.userConfig.activeGlobalProfile,
      globalProfiles: this.getGlobalProfiles(),
      globalEnv: this.getGlobalEnv(key)
    };
  }

  createGlobalCustomProfile(profileKey, profileData = {}) {
    const key = profileKey.trim().toLowerCase().replace(/\s+/g, '-');
    if (!key) throw new Error('Tên profile không hợp lệ!');
    if (!this.userConfig.globalProfiles) {
      this.userConfig.globalProfiles = { default: { env: {} } };
    }
    this.userConfig.globalProfiles[key] = {
      name: profileData.name || key,
      description: profileData.description || `Global Profile ${key}`,
      env: profileData.env || {}
    };
    this.userConfig.activeGlobalProfile = key;

    // Automatically add this profile to all services
    const services = this.getServices();
    if (!this.userConfig.customProfiles) {
      this.userConfig.customProfiles = {};
    }
    if (!this.userConfig.customEnvOverrides) {
      this.userConfig.customEnvOverrides = {};
    }

    for (const svc of services) {
      if (!this.userConfig.customProfiles[svc.id]) {
        this.userConfig.customProfiles[svc.id] = {};
      }
      if (!this.userConfig.customProfiles[svc.id][key]) {
        const baseEnv = svc.profiles?.default?.env || svc.computedEnv || {};
        this.userConfig.customProfiles[svc.id][key] = {
          name: profileData.name || key,
          description: `Profile ${key} (Được tạo tự động từ Global Profile)`,
          env: { ...baseEnv }
        };
      }
      if (!this.userConfig.customEnvOverrides[svc.id]) {
        this.userConfig.customEnvOverrides[svc.id] = {};
      }
      if (!this.userConfig.customEnvOverrides[svc.id][key]) {
        this.userConfig.customEnvOverrides[svc.id][key] = {};
      }

      if (profileData.env) {
        const relevantUpdates = {};
        for (const [k, v] of Object.entries(profileData.env)) {
          if (svc.computedEnv && svc.computedEnv[k] !== undefined) {
            relevantUpdates[k] = v;
          }
        }
        if (Object.keys(relevantUpdates).length > 0) {
          this.userConfig.customEnvOverrides[svc.id][key] = {
            ...this.userConfig.customEnvOverrides[svc.id][key],
            ...relevantUpdates
          };
        }
      }
    }

    this.saveUserConfig();
    return {
      activeGlobalProfile: key,
      globalProfiles: this.getGlobalProfiles(),
      globalEnv: this.userConfig.globalProfiles[key].env,
      services: this.getServices()
    };
  }

  deleteGlobalCustomProfile(profileKey) {
    const key = profileKey.trim().toLowerCase();
    if (key === 'default') {
      throw new Error('Không thể xóa profile default!');
    }
    if (this.userConfig.globalProfiles && this.userConfig.globalProfiles[key]) {
      delete this.userConfig.globalProfiles[key];
    }
    const remaining = Object.keys(this.userConfig.globalProfiles || {});
    if (this.userConfig.activeGlobalProfile === key || !remaining.includes(this.userConfig.activeGlobalProfile)) {
      this.userConfig.activeGlobalProfile = remaining[0] || 'default';
    }
    this.saveUserConfig();
    return {
      activeGlobalProfile: this.userConfig.activeGlobalProfile,
      globalProfiles: this.getGlobalProfiles(),
      globalEnv: this.getGlobalEnv(this.userConfig.activeGlobalProfile)
    };
  }

  getGlobalEnv(profileKey) {
    const activeKey = (profileKey || this.userConfig.activeGlobalProfile || 'default').toLowerCase();
    const profiles = this.getGlobalProfiles();
    return profiles[activeKey]?.env || profiles.default?.env || {};
  }

  applyGlobalEnv(globalVars, profileKey) {
    const activeKey = (profileKey || this.userConfig.activeGlobalProfile || 'default').toLowerCase();
    if (!this.userConfig.globalProfiles) {
      this.userConfig.globalProfiles = { default: { env: {} } };
    }
    if (!this.userConfig.globalProfiles[activeKey]) {
      this.userConfig.globalProfiles[activeKey] = { env: {} };
    }
    this.userConfig.globalProfiles[activeKey].env = globalVars || {};
    this.userConfig.globalEnv = globalVars || {}; // backward compatibility

    // Apply to services currently matching this profile
    const services = this.getServices();
    for (const svc of services) {
      const svcActiveProfile = this.userConfig.activeProfiles[svc.id] || svc.defaultProfile || 'default';
      if (svcActiveProfile === activeKey || activeKey === 'default') {
        if (!this.userConfig.customEnvOverrides[svc.id]) {
          this.userConfig.customEnvOverrides[svc.id] = {};
        }
        const currentOverrides = this.userConfig.customEnvOverrides[svc.id][svcActiveProfile] || {};
        const relevantUpdates = {};
        for (const [k, v] of Object.entries(globalVars)) {
          if (svc.computedEnv && svc.computedEnv[k] !== undefined) {
            relevantUpdates[k] = v;
          }
        }
        if (Object.keys(relevantUpdates).length > 0) {
          this.userConfig.customEnvOverrides[svc.id][svcActiveProfile] = {
            ...currentOverrides,
            ...relevantUpdates
          };
        }
      }
    }
    this.saveUserConfig();
    return {
      activeGlobalProfile: activeKey,
      globalProfiles: this.getGlobalProfiles(),
      globalEnv: this.userConfig.globalProfiles[activeKey].env,
      services: this.getServices()
    };
  }

  getEffectiveEnvForService(serviceId) {
    const svc = this.getServiceById(serviceId);
    if (!svc) return {};

    const cleanBaseEnv = { ...process.env };
    delete cleanBaseEnv.PORT;

    const effective = {
      ...cleanBaseEnv,
      ...svc.computedEnv
    };

    if (svc.port && !effective.PORT) {
      effective.PORT = String(svc.port);
    }

    return effective;
  }

  // ================= CUSTOM SCRIPTS MANAGEMENT =================
  getServiceScripts(serviceId) {
    if (!this.userConfig.customScripts) {
      this.userConfig.customScripts = {};
    }
    return this.userConfig.customScripts[serviceId] || [];
  }

  addServiceScript(serviceId, scriptData) {
    if (!this.userConfig.customScripts) {
      this.userConfig.customScripts = {};
    }
    if (!this.userConfig.customScripts[serviceId]) {
      this.userConfig.customScripts[serviceId] = [];
    }

    const newScript = {
      id: scriptData.id || `script_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: (scriptData.name || 'Custom Script').trim(),
      command: (scriptData.command || '').trim(),
      file: scriptData.file || '',
      icon: scriptData.icon || '⚡',
      runner: scriptData.runner || 'bash',
      cwd: scriptData.cwd || '',
      createdAt: new Date().toISOString()
    };

    const idx = this.userConfig.customScripts[serviceId].findIndex(s => s.id === newScript.id);
    if (idx >= 0) {
      this.userConfig.customScripts[serviceId][idx] = newScript;
    } else {
      this.userConfig.customScripts[serviceId].push(newScript);
    }

    this.saveUserConfig();
    return newScript;
  }

  deleteServiceScript(serviceId, scriptId) {
    if (!this.userConfig.customScripts || !this.userConfig.customScripts[serviceId]) {
      return { success: false, error: 'No scripts found' };
    }
    this.userConfig.customScripts[serviceId] = this.userConfig.customScripts[serviceId].filter(s => s.id !== scriptId);
    this.saveUserConfig();
    return { success: true, scriptId };
  }

  scanDirectoryScripts(dirPath) {
    if (!dirPath || typeof dirPath !== 'string' || !fs.existsSync(dirPath)) {
      return [];
    }
    try {
      const scriptExts = ['.sh', '.bash', '.js', '.mjs', '.ts', '.py', '.sql'];
      const results = [];

      const walk = (currentDir, depth = 0) => {
        if (depth > 2) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (scriptExts.includes(ext)) {
              const rel = path.relative(dirPath, fullPath);
              const relPath = rel.startsWith('.') ? rel : `./${rel}`;
              let defaultRunner = 'bash';
              if (ext === '.js' || ext === '.mjs') defaultRunner = 'node';
              else if (ext === '.ts') defaultRunner = 'pnpm ts-node';
              else if (ext === '.py') defaultRunner = 'python3';
              
              results.push({
                name: entry.name,
                fullPath,
                relativePath: relPath,
                ext,
                defaultRunner,
                suggestedCommand: `${defaultRunner} ${relPath}`
              });
            }
          } else if (entry.isDirectory() && ['scripts', 'bin', 'tools', 'sh', 'tasks'].includes(entry.name.toLowerCase())) {
            walk(fullPath, depth + 1);
          }
        }
      };

      walk(dirPath, 0);
      return results;
    } catch (e) {
      console.error('[EnvManager] Error scanning directory scripts:', e);
      return [];
    }
  }

  // ================= GLOBAL SCRIPTS MANAGEMENT =================
  getGlobalScripts() {
    if (!Array.isArray(this.userConfig.globalScripts)) {
      this.userConfig.globalScripts = [];
    }
    return this.userConfig.globalScripts;
  }

  parseRawEnvText(rawText) {
    if (!rawText || typeof rawText !== 'string') return {};
    const result = {};
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) result[key] = val;
      }
    }
    return result;
  }

  detectScriptEnv(cwd, cwdType) {
    const rootDir = this.userConfig.workspaceRoot || ROOT_DIR;
    const targetCwd = cwd || rootDir;

    // Check if it matches a service
    if (cwdType && cwdType !== 'workspace' && cwdType !== 'custom') {
      const svc = this.getServiceById(cwdType);
      if (svc) {
        const effectiveEnv = this.getEffectiveEnvForService(svc.id);
        const keys = Object.keys(effectiveEnv);
        return {
          source: 'service',
          serviceId: svc.id,
          serviceName: svc.name,
          profile: svc.activeProfile,
          count: keys.length,
          keys: keys.slice(0, 10),
          envPath: path.join(svc.cwd, '.env')
        };
      }
    }

    // Check directory files for .env
    const possibleEnvFiles = ['.env', '.env.local', '.env.development'];
    for (const envFileName of possibleEnvFiles) {
      const envPath = path.join(targetCwd, envFileName);
      if (fs.existsSync(envPath)) {
        const parsed = this.parseEnvFile(envPath);
        const keys = Object.keys(parsed);
        return {
          source: 'file',
          fileName: envFileName,
          filePath: envPath,
          count: keys.length,
          keys: keys.slice(0, 10)
        };
      }
    }

    // Fallback: Global Env
    const globalEnv = this.getEffectiveGlobalEnv();
    const gKeys = Object.keys(globalEnv);
    return {
      source: 'global',
      count: gKeys.length,
      keys: gKeys.slice(0, 10)
    };
  }

  getEffectiveEnvForScript(scriptConfig) {
    let baseEnv = {};
    const rootDir = this.userConfig.workspaceRoot || ROOT_DIR;
    const targetCwd = scriptConfig.cwd || rootDir;
    let sourceDesc = 'System Default';

    // 1. If service type
    if (scriptConfig.cwdType && scriptConfig.cwdType !== 'workspace' && scriptConfig.cwdType !== 'custom') {
      const svc = this.getServiceById(scriptConfig.cwdType);
      if (svc) {
        baseEnv = { ...this.getEffectiveEnvForService(svc.id) };
        sourceDesc = `Service: ${svc.name} (${svc.activeProfile})`;
      }
    } else {
      // 2. Load global env
      baseEnv = { ...this.getEffectiveGlobalEnv() };

      // 3. Check for .env file in CWD
      const possibleEnvFiles = ['.env', '.env.local', '.env.development'];
      for (const envFileName of possibleEnvFiles) {
        const envPath = path.join(targetCwd, envFileName);
        if (fs.existsSync(envPath)) {
          const fileEnv = this.parseEnvFile(envPath);
          baseEnv = { ...baseEnv, ...fileEnv };
          sourceDesc = `${envFileName} (${path.basename(targetCwd)})`;
          break;
        }
      }
    }

    // 4. Custom script env overrides
    let customOverrides = {};
    if (scriptConfig.envOverrides && typeof scriptConfig.envOverrides === 'object') {
      customOverrides = { ...scriptConfig.envOverrides };
    }
    if (scriptConfig.rawEnv) {
      const parsedRaw = this.parseRawEnvText(scriptConfig.rawEnv);
      customOverrides = { ...customOverrides, ...parsedRaw };
    }

    const combinedEnv = { ...baseEnv, ...customOverrides };

    return {
      env: combinedEnv,
      sourceDesc,
      count: Object.keys(combinedEnv).length,
      overrideCount: Object.keys(customOverrides).length
    };
  }

  addGlobalScript(scriptData) {
    if (!Array.isArray(this.userConfig.globalScripts)) {
      this.userConfig.globalScripts = [];
    }

    const rawEnv = typeof scriptData.rawEnv === 'string' ? scriptData.rawEnv : '';
    const parsedEnvOverrides = this.parseRawEnvText(rawEnv);
    const envOverrides = {
      ...(typeof scriptData.envOverrides === 'object' ? scriptData.envOverrides : {}),
      ...parsedEnvOverrides
    };

    const newScript = {
      id: scriptData.id || `gscript_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: (scriptData.name || 'Custom Script').trim(),
      command: (scriptData.command || '').trim(),
      file: scriptData.file || '',
      icon: scriptData.icon || '⚡',
      runner: scriptData.runner || 'bash',
      cwd: scriptData.cwd || this.userConfig.workspaceRoot || ROOT_DIR,
      cwdType: scriptData.cwdType || 'workspace',
      rawEnv,
      envOverrides,
      createdAt: new Date().toISOString()
    };

    const idx = this.userConfig.globalScripts.findIndex(s => s.id === newScript.id);
    if (idx >= 0) {
      this.userConfig.globalScripts[idx] = newScript;
    } else {
      this.userConfig.globalScripts.push(newScript);
    }

    this.saveUserConfig();
    return newScript;
  }

  deleteGlobalScript(scriptId) {
    if (!Array.isArray(this.userConfig.globalScripts)) {
      this.userConfig.globalScripts = [];
      return { success: false, error: 'No scripts found' };
    }
    this.userConfig.globalScripts = this.userConfig.globalScripts.filter(s => s.id !== scriptId);
    this.saveUserConfig();
    return { success: true, scriptId };
  }
}

module.exports = new EnvManager();
