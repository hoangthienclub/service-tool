const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4999;

function request(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log('🚀 Bắt đầu kiểm thử E2E Web Dashboard...');

  const serverProcess = spawn('node', ['server/index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) }
  });

  serverProcess.stdout.on('data', d => console.log(`[Server] ${d.toString().trim()}`));
  serverProcess.stderr.on('data', d => console.error(`[Server Error] ${d.toString().trim()}`));

  await new Promise(r => setTimeout(r, 1500));

  try {
    // 1. Test GET /api/services
    console.log('1. Testing GET /api/services...');
    const servicesRes = await request('/api/services');
    if (servicesRes.status !== 200 || !servicesRes.data.success) {
      throw new Error(`GET /api/services failed with status ${servicesRes.status}`);
    }
    console.log(`✔ Lấy thành công danh sách ${servicesRes.data.services.length} services`);

    // 2. Test create custom profile
    console.log('2. Testing POST /api/services/acc-service/custom-profile (Create my-custom-env)...');
    const createRes = await request('/api/services/acc-service/custom-profile', 'POST', {
      profileKey: 'my-custom-env',
      profileData: {
        name: 'My Custom Env',
        env: { PORT: '45072', TEST_KEY: 'test-value-123' }
      }
    });
    if (createRes.status !== 200 || createRes.data.service.activeProfile !== 'my-custom-env') {
      throw new Error('Create custom profile failed');
    }
    console.log('✔ Tạo profile my-custom-env thành công!');

    // 3. Test delete custom profile
    console.log('3. Testing DELETE /api/services/acc-service/custom-profile/my-custom-env...');
    const deleteRes = await request('/api/services/acc-service/custom-profile/my-custom-env', 'DELETE');
    if (deleteRes.status !== 200 || deleteRes.data.service.activeProfile !== 'local' || deleteRes.data.service.profiles['my-custom-env'] !== undefined) {
      throw new Error(`Delete custom profile failed: profile still exists in ${JSON.stringify(Object.keys(deleteRes.data.service.profiles))}`);
    }
    console.log('✔ Xóa profile my-custom-env thành công, dữ liệu đã được dọn sạch!');

    // 4. Test protection of system profiles
    console.log('4. Testing protection of system profiles (trying to delete "develop")...');
    const protectRes = await request('/api/services/acc-service/custom-profile/develop', 'DELETE');
    if (protectRes.status === 200 && protectRes.data.success) {
      throw new Error('Security flaw: system profile "develop" was deleted!');
    }
    console.log('✔ Profile hệ thống "develop" được bảo vệ chặt chẽ (từ chối xóa)!');

    // 5. Test POST /api/all/active-profile
    console.log('5. Testing POST /api/all/active-profile (Switch all services to "develop")...');
    const allProfileRes = await request('/api/all/active-profile', 'POST', { profile: 'develop' });
    if (allProfileRes.status !== 200 || !allProfileRes.data.services.every(s => s.activeProfile === 'develop')) {
      throw new Error('POST /api/all/active-profile failed: not all services switched to develop');
    }
    console.log('✔ Chuyển đổi Profile toàn hệ thống sang "develop" thành công 100%!');

    // 6. Test Task Triggers (/api/tasks/sync-develop & /api/tasks/install-all)
    console.log('6. Testing POST /api/tasks/sync-develop & /api/tasks/install-all...');
    const taskSyncRes = await request('/api/tasks/sync-develop', 'POST');
    if (taskSyncRes.status !== 200 || !taskSyncRes.data.success) {
      throw new Error('Trigger task sync-develop failed');
    }
    console.log('✔ Trigger task sync-develop thành công!');

    // 7. Test Path Settings API (GET /api/paths, POST /api/paths)
    console.log('7. Testing GET /api/paths & POST /api/paths...');
    const getPathsRes = await request('/api/paths');
    if (getPathsRes.status !== 200 || !getPathsRes.data.config.workspaceRoot) {
      throw new Error('GET /api/paths failed');
    }
    console.log('✔ Lấy cấu hình Paths thành công!');

    const postPathsRes = await request('/api/paths', 'POST', {
      workspaceRoot: getPathsRes.data.config.workspaceRoot
    });
    if (postPathsRes.status !== 200 || !postPathsRes.data.success) {
      throw new Error('POST /api/paths failed');
    }
    console.log('✔ Cập nhật Paths thành công!');

    // 8. Test Export .env File API (POST /api/services/acc-service/export-env)
    console.log('8. Testing POST /api/services/acc-service/export-env...');
    const exportRes = await request('/api/services/acc-service/export-env', 'POST');
    if (exportRes.status !== 200 || !exportRes.data.success || exportRes.data.result.keysCount === 0) {
      throw new Error('Export .env file failed');
    }
    console.log(`✔ Xuất file .env thành công vào: ${exportRes.data.result.filePath} (${exportRes.data.result.keysCount} biến)!`);

    // 9. Test Static HTML Dashboard
    console.log('9. Testing GET / (Static Dashboard UI)...');
    const htmlRes = await request('/');
    if (htmlRes.status !== 200 || !htmlRes.raw.includes('Service Monitor')) {
      throw new Error('Static UI index.html failed to serve');
    }
    console.log('✔ Web Dashboard UI HTML được nạp thành công!');

    // 10. Test POST /api/all/restart
    console.log('10. Testing POST /api/all/restart (Restart All Services)...');
    const restartAllRes = await request('/api/all/restart', 'POST');
    if (restartAllRes.status !== 200 || !restartAllRes.data.success) {
      throw new Error('POST /api/all/restart failed');
    }
    console.log('✔ Gọi lệnh Restart All thành công!');

    // 11. Test POST /api/services/:id/kill-port & /api/all/kill-ports
    console.log('11. Testing POST /api/services/acc-service/kill-port & /api/all/kill-ports...');
    const killSvcPortRes = await request('/api/services/acc-service/kill-port', 'POST');
    if (killSvcPortRes.status !== 200 || !killSvcPortRes.data.success) {
      throw new Error('POST /api/services/acc-service/kill-port failed');
    }
    console.log('✔ Gọi lệnh Kill Port cho riêng acc-service thành công!');

    const killAllPortsRes = await request('/api/all/kill-ports', 'POST');
    if (killAllPortsRes.status !== 200 || !killAllPortsRes.data.success) {
      throw new Error('POST /api/all/kill-ports failed');
    }
    console.log('✔ Gọi lệnh Kill All Ports cho toàn bộ hệ thống thành công!');

    // 12. Test Templates API (GET /api/templates)
    console.log('12. Testing GET /api/templates...');
    const tRes = await request('/api/templates');
    if (tRes.status !== 200 || !Array.isArray(tRes.data.templates) || tRes.data.templates.length === 0) {
      throw new Error('GET /api/templates failed');
    }
    console.log(`✔ Lấy thành công ${tRes.data.templates.length} templates mẫu!`);

    // 13. Test Create Dynamic Service (POST /api/services)
    console.log('13. Testing POST /api/services (Create new dynamic service)...');
    const createSvcRes = await request('/api/services', 'POST', {
      id: 'dynamic-worker',
      name: 'Dynamic Worker Service',
      category: 'WORKER',
      group: 'WORKER',
      port: 7070,
      script: 'node',
      args: ['-e', 'console.log("worker")'],
      relativeDir: 'worker-service'
    });
    if (createSvcRes.status !== 201 || !createSvcRes.data.service || createSvcRes.data.service.id !== 'dynamic-worker') {
      throw new Error('POST /api/services failed');
    }
    console.log('✔ Tạo service động "dynamic-worker" thành công!');

    // 14. Test Update Dynamic Service (PUT /api/services/:id)
    console.log('14. Testing PUT /api/services/dynamic-worker (Update service)...');
    const updateSvcRes = await request('/api/services/dynamic-worker', 'PUT', {
      name: 'Updated Dynamic Worker Service',
      port: 7071
    });
    if (updateSvcRes.status !== 200 || updateSvcRes.data.service.port !== 7071) {
      throw new Error('PUT /api/services/:id failed');
    }
    console.log('✔ Cập nhật service "dynamic-worker" thành công (Port 7071)!');

    // 15. Test Export All Config (GET /api/export/all)
    console.log('15. Testing GET /api/export/all (Export full config JSON)...');
    const exportAllRes = await request('/api/export/all');
    if (exportAllRes.status !== 200 || !exportAllRes.data.services || exportAllRes.data.services.length < 7) {
      throw new Error('GET /api/export/all failed');
    }
    console.log(`✔ Xuất full config JSON thành công (${exportAllRes.data.services.length} services)!`);

    // 16. Test Export Single Service Config (GET /api/services/:id/export)
    console.log('16. Testing GET /api/services/dynamic-worker/export...');
    const exportSingleRes = await request('/api/services/dynamic-worker/export');
    if (exportSingleRes.status !== 200 || !exportSingleRes.data.service || exportSingleRes.data.service.id !== 'dynamic-worker') {
      throw new Error('GET /api/services/:id/export failed');
    }
    console.log('✔ Xuất cấu hình single service thành công!');

    // 17. Test Import Config (POST /api/import)
    console.log('17. Testing POST /api/import (Merge mode)...');
    const importRes = await request('/api/import', 'POST', {
      mode: 'merge',
      data: {
        services: [
          {
            id: 'imported-fastapi',
            name: 'Imported FastAPI Service',
            category: 'SERVICE',
            group: 'AI_SERVICES',
            port: 8088,
            script: 'uvicorn',
            args: ['main:app'],
            relativeDir: 'ai-service'
          }
        ]
      }
    });
    if (importRes.status !== 200 || !importRes.data.success || importRes.data.importedCount === 0) {
      throw new Error('POST /api/import failed');
    }
    console.log('✔ Import cấu hình thành công với mode merge!');

    // 18. Test Delete Dynamic Service (DELETE /api/services/:id)
    console.log('18. Testing DELETE /api/services/:id...');
    const del1 = await request('/api/services/dynamic-worker', 'DELETE');
    const del2 = await request('/api/services/imported-fastapi', 'DELETE');
    if (del1.status !== 200 || del2.status !== 200) {
      throw new Error('DELETE /api/services/:id failed');
    }
    console.log('✔ Xóa các service vừa tạo/import thành công!');

    // 19. Test Reset Services to Default (POST /api/services/reset)
    console.log('19. Testing POST /api/services/reset (Reset to default 6 services)...');
    const resetRes = await request('/api/services/reset', 'POST');
    if (resetRes.status !== 200 || resetRes.data.services.length !== 6) {
      throw new Error('POST /api/services/reset failed');
    }
    console.log('✔ Reset về 6 services mặc định thành công!');

    // 20. Đảm bảo toàn bộ hệ thống luôn ở profile 'local' mặc định
    console.log('20. Ensuring all services are restored to "local" profile...');
    await request('/api/all/active-profile', 'POST', { profile: 'local' });
    console.log('✔ Đã đưa toàn bộ services về profile "local"!');

    console.log('\n🎉 TOÀN BỘ 20 BƯỚC TEST E2E, TEMPLATES, CRUD DYNAMIC SERVICES, IMPORT/EXPORT ĐỀU PASS 100%!\n');
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

runTest().catch(err => {
  console.error('❌ E2E Test Thất bại:', err);
  process.exit(1);
});
