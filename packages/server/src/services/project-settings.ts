import type { ProjectMetadata, Project, ProjectMetadataCategory } from '@cloudscode/shared';
import { getDb } from '../db/database.js';
import { getSettingsStore } from '../db/settings-store.js';
import { logger } from '../logger.js';

export interface ProjectSettingsUpdate {
  category: ProjectMetadataCategory;
  data: any;
}

export interface ProjectConfigTemplate {
  name: string;
  description: string;
  metadata: Partial<ProjectMetadata>;
}

class ProjectSettingsService {
  /**
   * Get project metadata by project ID
   */
  getProjectMetadata(projectId: string): ProjectMetadata {
    const db = getDb();
    const project = db
      .prepare('SELECT metadata FROM projects WHERE id = ?')
      .get(projectId) as { metadata: string } | undefined;

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    try {
      return JSON.parse(project.metadata || '{}') as ProjectMetadata;
    } catch (err) {
      logger.error({ err, projectId }, 'Failed to parse project metadata');
      return {};
    }
  }

  /**
   * Update specific category of project metadata
   */
  updateProjectMetadata(
    projectId: string,
    category: ProjectMetadataCategory,
    data: any
  ): ProjectMetadata {
    const currentMetadata = this.getProjectMetadata(projectId);
    const updatedMetadata = {
      ...currentMetadata,
      [category]: data,
    };

    this.saveProjectMetadata(projectId, updatedMetadata);
    return updatedMetadata;
  }

  /**
   * Save complete project metadata
   */
  saveProjectMetadata(projectId: string, metadata: ProjectMetadata): void {
    const db = getDb();
    const metadataJson = JSON.stringify(metadata);

    db.prepare(
      `UPDATE projects
       SET metadata = ?, updated_at = unixepoch()
       WHERE id = ?`
    ).run(metadataJson, projectId);

    logger.info({ projectId }, 'Project metadata updated');
  }

  /**
   * Get global settings (server-wide configuration)
   */
  getGlobalSettings(): Record<string, string> {
    const store = getSettingsStore();
    const db = getDb();
    const settings = db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;

    return settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Set global setting
   */
  setGlobalSetting(key: string, value: string): void {
    const store = getSettingsStore();
    store.set(key, value);
    logger.info({ key }, 'Global setting updated');
  }

  /**
   * Auto-detect project configuration from codebase
   */
  async autoDetectProjectConfig(projectPath: string): Promise<Partial<ProjectMetadata>> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const metadata: Partial<ProjectMetadata> = {};

    try {
      // Detect package manager
      const packageJsonPath = path.join(projectPath, 'package.json');
      if (await this.fileExists(packageJsonPath)) {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

        // Detect package manager from lock files
        if (await this.fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
          metadata.packageManager = 'pnpm';
        } else if (await this.fileExists(path.join(projectPath, 'yarn.lock'))) {
          metadata.packageManager = 'yarn';
        } else if (await this.fileExists(path.join(projectPath, 'bun.lockb'))) {
          metadata.packageManager = 'bun';
        } else {
          metadata.packageManager = 'npm';
        }

        // Detect scripts
        if (packageJson.scripts) {
          metadata.scripts = Object.entries(packageJson.scripts).map(([name, command]) => ({
            name,
            command: command as string,
            description: `Package.json script: ${name}`,
          }));
        }

        // Detect key dependencies
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        metadata.keyDependencies = Object.entries(allDeps)
          .filter(([name]) => this.isKeyDependency(name))
          .map(([name, version]) => ({
            name,
            version: version as string,
            purpose: this.getDependencyPurpose(name),
          }));
      }

      // Detect monorepo tools
      if (await this.fileExists(path.join(projectPath, 'turbo.json'))) {
        metadata.monorepoTool = 'turborepo';
      } else if (await this.fileExists(path.join(projectPath, 'nx.json'))) {
        metadata.monorepoTool = 'nx';
      } else if (await this.fileExists(path.join(projectPath, 'lerna.json'))) {
        metadata.monorepoTool = 'lerna';
      }

      // Detect testing frameworks
      metadata.testing = [];
      if (await this.fileExists(path.join(projectPath, 'vitest.config.ts'))) {
        metadata.testing.push({
          framework: 'vitest',
          configPath: 'vitest.config.ts',
          types: ['unit', 'integration'],
        });
      }
      if (await this.fileExists(path.join(projectPath, 'jest.config.js'))) {
        metadata.testing.push({
          framework: 'jest',
          configPath: 'jest.config.js',
          types: ['unit', 'integration'],
        });
      }

      // Detect build tools
      metadata.build = [];
      if (await this.fileExists(path.join(projectPath, 'vite.config.ts'))) {
        metadata.build.push({
          tool: 'vite',
          configPath: 'vite.config.ts',
          outputDir: 'dist',
        });
      }
      if (await this.fileExists(path.join(projectPath, 'tsconfig.json'))) {
        metadata.build.push({
          tool: 'tsc',
          configPath: 'tsconfig.json',
          outputDir: 'dist',
        });
      }

      // Detect linting
      metadata.linting = [];
      if (await this.fileExists(path.join(projectPath, '.eslintrc.json'))) {
        metadata.linting.push({
          tool: 'eslint',
          configPath: '.eslintrc.json',
        });
      }
      if (await this.fileExists(path.join(projectPath, 'biome.json'))) {
        metadata.linting.push({
          tool: 'biome',
          configPath: 'biome.json',
        });
      }

      // Detect CI/CD
      metadata.ciCd = [];
      if (await this.fileExists(path.join(projectPath, '.github/workflows'))) {
        metadata.ciCd.push({
          platform: 'github_actions',
          configPath: '.github/workflows',
          description: 'GitHub Actions workflows',
        });
      }

      // Detect Git configuration
      if (await this.fileExists(path.join(projectPath, '.git'))) {
        metadata.git = {
          defaultBranch: 'main', // Default assumption
          commitConvention: 'conventional',
        };
      }

      return metadata;
    } catch (err) {
      logger.error({ err, projectPath }, 'Failed to auto-detect project configuration');
      return {};
    }
  }

  /**
   * Get predefined project templates
   */
  getProjectTemplates(): ProjectConfigTemplate[] {
    return [
      {
        name: 'Full-Stack TypeScript',
        description: 'Modern full-stack application with TypeScript, React, and Node.js',
        metadata: {
          architecturePattern: 'layered',
          packageManager: 'pnpm',
          techStack: [
            { name: 'TypeScript', role: 'Programming Language', isPrimary: true },
            { name: 'React', role: 'Frontend Framework', isPrimary: true },
            { name: 'Node.js', role: 'Backend Runtime', isPrimary: true },
            { name: 'Express', role: 'Backend Framework' },
            { name: 'Vite', role: 'Build Tool' },
          ],
          testing: [
            { framework: 'vitest', types: ['unit', 'integration'] },
            { framework: 'playwright', types: ['e2e'] },
          ],
          linting: [
            { tool: 'eslint', configPath: '.eslintrc.json' },
            { tool: 'prettier', configPath: '.prettierrc' },
          ],
        },
      },
      {
        name: 'Express API Server',
        description: 'RESTful API server with Express.js and TypeScript',
        metadata: {
          architecturePattern: 'layered',
          packageManager: 'npm',
          apiEndpoints: [
            { name: 'API v1', basePath: '/api/v1', style: 'rest' },
          ],
          techStack: [
            { name: 'Node.js', role: 'Runtime', isPrimary: true },
            { name: 'Express', role: 'Web Framework', isPrimary: true },
            { name: 'TypeScript', role: 'Language', isPrimary: true },
          ],
          testing: [
            { framework: 'jest', types: ['unit', 'integration'] },
          ],
        },
      },
      {
        name: 'Next.js Application',
        description: 'Full-stack React application with Next.js',
        metadata: {
          architecturePattern: 'modular_monolith',
          packageManager: 'npm',
          techStack: [
            { name: 'Next.js', role: 'Full-Stack Framework', isPrimary: true },
            { name: 'React', role: 'Frontend Library', isPrimary: true },
            { name: 'TypeScript', role: 'Language', isPrimary: true },
          ],
          folderMappings: [
            { path: 'app', purpose: 'App Router pages and layouts' },
            { path: 'components', purpose: 'Reusable React components' },
            { path: 'lib', purpose: 'Utility functions and configuration' },
            { path: 'public', purpose: 'Static assets' },
          ],
        },
      },
      {
        name: 'Microservices Architecture',
        description: 'Microservices with Docker and Kubernetes',
        metadata: {
          architecturePattern: 'microservices',
          services: [
            { name: 'user-service', type: 'api', port: 3001, description: 'User management API' },
            { name: 'product-service', type: 'api', port: 3002, description: 'Product catalog API' },
            { name: 'gateway', type: 'api', port: 3000, description: 'API Gateway' },
          ],
          infraAsCode: [
            { tool: 'docker_compose', path: 'docker-compose.yml' },
            { tool: 'kubernetes', path: 'k8s/', description: 'Kubernetes manifests' },
          ],
          messageQueues: [
            { name: 'primary-queue', type: 'rabbitmq', purpose: 'Inter-service communication' },
          ],
        },
      },
    ];
  }

  /**
   * Apply project template
   */
  applyProjectTemplate(projectId: string, templateName: string): ProjectMetadata {
    const template = this.getProjectTemplates().find(t => t.name === templateName);
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    const currentMetadata = this.getProjectMetadata(projectId);
    const mergedMetadata = this.mergeMetadata(currentMetadata, template.metadata);

    this.saveProjectMetadata(projectId, mergedMetadata);
    logger.info({ projectId, templateName }, 'Project template applied');

    return mergedMetadata;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private isKeyDependency(name: string): boolean {
    const keyDeps = [
      'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby',
      'express', 'fastify', 'koa', 'hapi',
      'prisma', 'typeorm', 'sequelize', 'mongoose',
      'jest', 'vitest', 'mocha', 'cypress', 'playwright',
      'webpack', 'vite', 'rollup', 'esbuild',
      'tailwindcss', 'styled-components', 'emotion',
      'apollo', 'graphql', 'relay',
      'redux', 'zustand', 'recoil', 'jotai',
    ];
    return keyDeps.some(dep => name.includes(dep));
  }

  private getDependencyPurpose(name: string): string {
    const purposes: Record<string, string> = {
      react: 'Frontend UI library',
      vue: 'Frontend framework',
      angular: 'Frontend framework',
      express: 'Backend web framework',
      next: 'Full-stack React framework',
      prisma: 'Database ORM',
      jest: 'Testing framework',
      vitest: 'Testing framework',
      vite: 'Build tool',
      tailwindcss: 'CSS framework',
      typescript: 'Type-safe JavaScript',
    };

    for (const [key, purpose] of Object.entries(purposes)) {
      if (name.includes(key)) {
        return purpose;
      }
    }
    return 'Core dependency';
  }

  private mergeMetadata(
    current: ProjectMetadata,
    template: Partial<ProjectMetadata>
  ): ProjectMetadata {
    const merged = { ...current };

    for (const [key, value] of Object.entries(template)) {
      const typedKey = key as keyof ProjectMetadata;

      if (Array.isArray(value)) {
        // Merge arrays, avoiding duplicates where possible
        const currentArray = (merged[typedKey] as any[]) || [];
        merged[typedKey] = [...currentArray, ...value] as any;
      } else if (typeof value === 'object' && value !== null) {
        // Merge objects
        merged[typedKey] = { ...(merged[typedKey] as any), ...value } as any;
      } else {
        // Direct assignment for primitive values
        merged[typedKey] = value as any;
      }
    }

    return merged;
  }
}

let projectSettingsService: ProjectSettingsService;

export function getProjectSettingsService(): ProjectSettingsService {
  if (!projectSettingsService) {
    projectSettingsService = new ProjectSettingsService();
  }
  return projectSettingsService;
}