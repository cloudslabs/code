import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { initWebSocket } from './ws.js';
import { initDatabase, closeDatabase } from './db/database.js';
import { initProjectManager } from './projects/project-manager.js';
import { initOrchestrator } from './agents/orchestrator.js';
import { initPlanManager } from './plans/plan-manager.js';
import { initWorkflowTemplateStore } from './workflows/workflow-template-store.js';
import { initWorkflowManager } from './workflows/workflow-manager.js';
import { initContextManager } from './context/context-manager.js';
import { initTokenUsageStore } from './db/token-usage-store.js';
import { initMemoryStore } from './context/memory-store.js';
import { initWorkspaceFiles } from './workspace/workspace-files.js';
import { initSettingsStore } from './db/settings-store.js';

export interface StartServerOptions {
  staticDir?: string;
}

export interface ServerHandle {
  server: Server;
  shutdown: () => void;
}

export async function startServer(options?: StartServerOptions): Promise<ServerHandle> {
  const config = loadConfig();
  logger.info({ port: config.PORT }, 'Starting CLouds Code server');

  // Initialize database
  initDatabase(config.DATA_DIR);

  // Initialize stores and managers
  initSettingsStore();
  initMemoryStore();
  const projectManager = initProjectManager();
  initContextManager();
  initTokenUsageStore();
  await initWorkspaceFiles(config.PROJECT_ROOT);
  initOrchestrator(config);
  initPlanManager();
  initWorkflowTemplateStore();
  initWorkflowManager();

  // Ensure a default workspace exists for the project root
  const workspaceName = path.basename(config.PROJECT_ROOT);
  projectManager.ensureWorkspace(workspaceName, config.PROJECT_ROOT);

  // Create HTTP server with Express app
  const app = createApp(options?.staticDir);
  const server = createServer(app);

  // Attach WebSocket
  initWebSocket(server);

  // Start listening
  await new Promise<void>((resolve) => {
    server.listen(config.PORT, config.HOST, () => {
      logger.info({ host: config.HOST, port: config.PORT }, 'Server started');
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    server.close();
    closeDatabase();
  };

  return { server, shutdown };
}

// Auto-execute when run directly (not imported by Electron)
const isElectron = 'electron' in process.versions;

if (!isElectron) {
  startServer().then(({ shutdown }) => {
    process.on('SIGINT', () => { shutdown(); process.exit(0); });
    process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  }).catch((err) => {
    logger.error({ err }, 'Fatal error');
    process.exit(1);
  });
}
