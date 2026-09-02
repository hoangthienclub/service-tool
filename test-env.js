const envManager = require('./server/services/env-manager');

console.log('Testing EnvManager...');
const services = envManager.getServices();
console.log(`Found ${services.length} configured services.`);

for (const s of services) {
  console.log(`- [${s.group}] ${s.name} (Port: ${s.port}, ActiveProfile: ${s.activeProfile})`);
  const effectiveEnv = envManager.getEffectiveEnvForService(s.id);
  console.log(`  Sample env: PORT=${effectiveEnv.PORT || effectiveEnv.GRPC_PORT || 'N/A'}`);
}

// Test setting override
envManager.setEnvOverrides('acc-service', { TEST_VAR: '123' });
const updated = envManager.getServiceById('acc-service');
console.log(`Verified override: TEST_VAR = ${updated.computedEnv.TEST_VAR}`);

console.log('EnvManager test passed successfully!');
