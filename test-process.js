const processManager = require('./server/services/process-manager');

async function test() {
  console.log('Testing ProcessManager...');
  const statuses = processManager.getAllStatuses();
  console.log('Initial statuses:', statuses);

  // Test log event
  let logReceived = false;
  processManager.on('log', (data) => {
    logReceived = true;
    console.log(`[Log Event Received] Service: ${data.serviceId}, Type: ${data.type}, Text: ${data.text.trim()}`);
  });

  processManager.appendLog('acc-service', 'Test log message', 'stdout');
  if (!logReceived) throw new Error('Log event not fired');

  const logs = processManager.getLogBuffer('acc-service');
  console.log(`Log buffer count: ${logs.length}`);

  processManager.clearLogs('acc-service');
  const clearedLogs = processManager.getLogBuffer('acc-service');
  console.log(`Cleared log buffer count: ${clearedLogs.length}`);

  console.log('ProcessManager tests passed successfully!');
}

test().catch(err => {
  console.error('ProcessManager test failed:', err);
  process.exit(1);
});
