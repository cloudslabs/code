import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { initWebSocket } from './ws.js';
import { initDatabase, closeDatabase } from './db/database.js';
import { initProjectManager } from './projects/project-manager.js';
import { initOrchestrator } from './agents/orchestrator.js';
import { initPlanManager } from './plans/plan-manager.js';
import { initContextManager } from './context/context-manager.js';
import { initMemoryStore } from './context/memory-store.js';
import { initWorkspaceFiles } from './workspace/workspace-files.js';
import { initSettingsStore } from './db/settings-store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.PORT }, 'Starting CLouds Code server');

  // Initialize database
  initDatabase(config.DATA_DIR);

  // Initialize stores and managers
  initSettingsStore();
  initMemoryStore();
  const projectManager = initProjectManager();
  initContextManager();
  await initWorkspaceFiles(config.PROJECT_ROOT);
  initOrchestrator(config);
  initPlanManager();

  // Ensure a default workspace exists for the project root
  const path = await import('node:path');
  const workspaceName = path.default.basename(config.PROJECT_ROOT);
  projectManager.ensureWorkspace(workspaceName, config.PROJECT_ROOT);

  // Create HTTP server with Express app
  const app = createApp();
  const server = createServer(app);

  // Attach WebSocket
  initWebSocket(server);

  // Start listening
  server.listen(config.PORT, config.HOST, () => {
    logger.info({ host: config.HOST, port: config.PORT }, 'Server started');
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    server.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
