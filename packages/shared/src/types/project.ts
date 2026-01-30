// =============================================================================
// Project Type Definitions
// A Project is a richly structured, persistent entity with ~20 categories
// of metadata (purpose, architecture, roadmap, services, conventions, AI config, etc.)
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Core Identity
// -----------------------------------------------------------------------------

export type ProjectStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'planning'
  | 'maintenance'
  | 'deprecated';

export interface ProjectGoal {
  description: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'abandoned';
  priority: PriorityLevel;
}

// -----------------------------------------------------------------------------
// 2. Technical Architecture
// -----------------------------------------------------------------------------

export interface TechStackEntry {
  name: string;
  version?: string;
  role: string; // e.g. "runtime", "framework", "build tool", "database"
  isPrimary?: boolean;
}

export type ArchitecturePattern =
  | 'monolith'
  | 'microservices'
  | 'serverless'
  | 'modular_monolith'
  | 'event_driven'
  | 'layered'
  | 'hexagonal'
  | 'cqrs'
  | 'other';

export type ApiStyle = 'rest' | 'graphql' | 'grpc' | 'websocket' | 'trpc' | 'other';

export interface DesignPattern {
  name: string;
  description: string;
  usedIn?: string[]; // file paths or module names
}

export interface ApiEndpointGroup {
  name: string;
  basePath: string;
  style: ApiStyle;
  description?: string;
}

// -----------------------------------------------------------------------------
// 3. Project Structure
// -----------------------------------------------------------------------------

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'other';
export type MonorepoTool = 'turborepo' | 'nx' | 'lerna' | 'rush' | 'none' | 'other';

export interface FolderMapping {
  path: string;
  purpose: string;
}

export interface EntryPoint {
  path: string;
  description: string;
  type: 'server' | 'client' | 'cli' | 'worker' | 'test' | 'other';
}

export interface ModuleDefinition {
  name: string;
  path: string;
  description: string;
  dependencies?: string[]; // names of other modules
}

// -----------------------------------------------------------------------------
// 4. Services & Infrastructure
// -----------------------------------------------------------------------------

export interface ServiceDefinition {
  name: string;
  type: 'api' | 'worker' | 'cron' | 'database' | 'cache' | 'queue' | 'frontend' | 'other';
  path?: string;
  port?: number;
  description?: string;
}

export interface DatabaseConfig {
  name: string;
  type: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'redis' | 'other';
  purpose?: string;
}

export interface MessageQueue {
  name: string;
  type: 'rabbitmq' | 'kafka' | 'sqs' | 'redis' | 'bullmq' | 'other';
  purpose?: string;
}

export interface CacheConfig {
  name: string;
  type: 'redis' | 'memcached' | 'in_memory' | 'other';
  purpose?: string;
}

export interface EnvironmentConfig {
  name: string;
  url?: string;
  description?: string;
}

export interface CiCdPipeline {
  platform: 'github_actions' | 'gitlab_ci' | 'jenkins' | 'circleci' | 'other';
  configPath: string;
  description?: string;
}

export interface InfraAsCodeConfig {
  tool: 'terraform' | 'pulumi' | 'cloudformation' | 'cdk' | 'docker_compose' | 'kubernetes' | 'other';
  path: string;
  description?: string;
}

// -----------------------------------------------------------------------------
// 5. Team & Roles
// -----------------------------------------------------------------------------

export interface TeamMember {
  name: string;
  role: string;
  areas?: string[]; // areas of ownership
}

export interface CodeOwnership {
  path: string;
  owners: string[];
}

// -----------------------------------------------------------------------------
// 6. Development Workflow
// -----------------------------------------------------------------------------

export interface GitConfig {
  defaultBranch: string;
  branchNamingPattern?: string;
  commitConvention?: 'conventional' | 'angular' | 'gitmoji' | 'freeform';
}

export interface PrProcess {
  requiredReviewers?: number;
  requiredChecks?: string[];
  description?: string;
}

export interface TestingStrategy {
  framework: string;
  configPath?: string;
  testDirectory?: string;
  coverageThreshold?: number;
  types?: ('unit' | 'integration' | 'e2e' | 'snapshot')[];
}

export interface LintingConfig {
  tool: 'eslint' | 'biome' | 'prettier' | 'oxlint' | 'other';
  configPath: string;
}

export interface BuildConfig {
  tool: 'vite' | 'webpack' | 'esbuild' | 'tsc' | 'turbopack' | 'rollup' | 'other';
  configPath?: string;
  outputDir?: string;
}

export interface ProjectScript {
  name: string;
  command: string;
  description?: string;
}

// -----------------------------------------------------------------------------
// 7. Roadmap & Planning
// -----------------------------------------------------------------------------

export type RoadmapItemType = 'milestone' | 'epic' | 'feature' | 'task' | 'bug';
export type RoadmapItemStatus = 'backlog' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RoadmapItem {
  id: string;
  type: RoadmapItemType;
  title: string;
  description?: string;
  status: RoadmapItemStatus;
  priority: PriorityLevel;
  dependencies?: string[]; // IDs of other roadmap items
  tags?: string[];
}

// -----------------------------------------------------------------------------
// 8. Coding Standards
// -----------------------------------------------------------------------------

export interface NamingConvention {
  target: string; // e.g. "files", "components", "variables", "functions"
  pattern: string; // e.g. "camelCase", "PascalCase", "kebab-case"
  example?: string;
}

export interface CodingStandard {
  rule: string;
  description: string;
  examples?: string[];
}

export interface ErrorHandlingPattern {
  context: string; // e.g. "API routes", "async operations"
  pattern: string;
  example?: string;
}

export interface LoggingStandard {
  framework: string; // e.g. "pino", "winston", "console"
  levels?: string[];
  format?: string;
  guidelines?: string;
}

// -----------------------------------------------------------------------------
// 9. Documentation
// -----------------------------------------------------------------------------

export interface DocumentationLink {
  title: string;
  url: string;
  type?: 'api' | 'guide' | 'architecture' | 'runbook' | 'other';
}

export interface Adr {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  date: string;
  context: string;
  decision: string;
  consequences?: string;
}

// -----------------------------------------------------------------------------
// 10. Dependencies & Integrations
// -----------------------------------------------------------------------------

export interface KeyDependency {
  name: string;
  version?: string;
  purpose: string;
  documentation?: string;
}

export interface ExternalIntegration {
  name: string;
  type: 'api' | 'webhook' | 'oauth' | 'sdk' | 'other';
  description?: string;
  documentation?: string;
}

// -----------------------------------------------------------------------------
// 11. Security
// -----------------------------------------------------------------------------

export type AuthMethod = 'jwt' | 'session' | 'oauth2' | 'api_key' | 'saml' | 'none' | 'other';
export type AuthorizationModel = 'rbac' | 'abac' | 'acl' | 'none' | 'other';

export interface SecurityConfig {
  authMethod: AuthMethod;
  authorizationModel: AuthorizationModel;
  sensitiveFiles?: string[];
  notes?: string;
}

// -----------------------------------------------------------------------------
// 12. Performance & Monitoring
// -----------------------------------------------------------------------------

export interface PerformanceBudget {
  metric: string;
  target: string;
  notes?: string;
}

export interface MonitoringConfig {
  tool: string;
  type: 'apm' | 'logging' | 'metrics' | 'tracing' | 'error_tracking' | 'other';
  description?: string;
}

export interface SlaDefinition {
  name: string;
  target: string;
  description?: string;
}

// -----------------------------------------------------------------------------
// 13. AI Context
// -----------------------------------------------------------------------------

export interface AiConfig {
  customInstructions?: string;
  avoidPaths?: string[];
  focusPaths?: string[];
  codeGenPreferences?: AiCodeGenPreferences;
  contextPriority?: AiContextPriority[];
  promptTemplates?: AiPromptTemplate[];
}

export interface AiCodeGenPreferences {
  preferredPatterns?: string[];
  avoidPatterns?: string[];
  commentStyle?: 'minimal' | 'moderate' | 'verbose';
  testGeneration?: 'always' | 'on_request' | 'never';
  typeAnnotations?: 'strict' | 'moderate' | 'inferred';
}

export interface AiContextPriority {
  category: string;
  priority: 'always' | 'when_relevant' | 'on_request' | 'never';
}

export interface AiPromptTemplate {
  name: string;
  template: string;
  description?: string;
}

// -----------------------------------------------------------------------------
// 14. Business Context
// -----------------------------------------------------------------------------

export interface DomainConcept {
  term: string;
  definition: string;
  relatedTerms?: string[];
}

export interface UserPersona {
  name: string;
  description: string;
  goals?: string[];
}

export interface BusinessRule {
  name: string;
  rule: string;
  context?: string;
}

// -----------------------------------------------------------------------------
// 15. Release & Versioning
// -----------------------------------------------------------------------------

export type VersioningScheme = 'semver' | 'calver' | 'incremental' | 'other';

export interface ReleaseConfig {
  versioningScheme: VersioningScheme;
  currentVersion?: string;
  releaseProcess?: string;
  changelogPath?: string;
}

// -----------------------------------------------------------------------------
// 16. Operational
// -----------------------------------------------------------------------------

export interface Runbook {
  name: string;
  scenario: string;
  steps: string[];
}

// -----------------------------------------------------------------------------
// 17. Accessibility & i18n
// -----------------------------------------------------------------------------

export interface AccessibilityConfig {
  standard: 'wcag_2.1_aa' | 'wcag_2.1_aaa' | 'section_508' | 'custom';
  guidelines?: string;
  testingTools?: string[];
}

export interface InternationalizationConfig {
  framework?: string;
  defaultLocale: string;
  supportedLocales: string[];
  translationPath?: string;
}

// -----------------------------------------------------------------------------
// 18. Feature Flags
// -----------------------------------------------------------------------------

export interface FeatureFlagConfig {
  provider: string; // e.g. "launchdarkly", "unleash", "custom", "environment"
  configPath?: string;
  flags?: FeatureFlag[];
}

export interface FeatureFlag {
  name: string;
  description?: string;
  defaultValue: boolean;
  environments?: Record<string, boolean>;
}

// -----------------------------------------------------------------------------
// 19. Migration & Legacy
// -----------------------------------------------------------------------------

export interface MigrationContext {
  from?: string;
  to?: string;
  status: 'planned' | 'in_progress' | 'completed';
  notes?: string;
  affectedAreas?: string[];
}

// -----------------------------------------------------------------------------
// 20. Known Issues & Tech Debt
// -----------------------------------------------------------------------------

export interface KnownIssue {
  title: string;
  description: string;
  severity: PriorityLevel;
  affectedAreas?: string[];
  workaround?: string;
}

export interface TechDebtItem {
  title: string;
  description: string;
  priority: PriorityLevel;
  effort?: 'small' | 'medium' | 'large';
  affectedFiles?: string[];
}

// =============================================================================
// Project Metadata (JSON blob stored in the metadata column)
// =============================================================================

export interface ProjectMetadata {
  // 1. Core Identity
  goals?: ProjectGoal[];
  tags?: string[];
  vision?: string;

  // 2. Technical Architecture
  techStack?: TechStackEntry[];
  architecturePattern?: ArchitecturePattern;
  designPatterns?: DesignPattern[];
  apiEndpoints?: ApiEndpointGroup[];

  // 3. Project Structure
  folderMappings?: FolderMapping[];
  entryPoints?: EntryPoint[];
  modules?: ModuleDefinition[];
  packageManager?: PackageManager;
  monorepoTool?: MonorepoTool;

  // 4. Services & Infrastructure
  services?: ServiceDefinition[];
  databases?: DatabaseConfig[];
  messageQueues?: MessageQueue[];
  caches?: CacheConfig[];
  environments?: EnvironmentConfig[];
  ciCd?: CiCdPipeline[];
  infraAsCode?: InfraAsCodeConfig[];

  // 5. Team & Roles
  team?: TeamMember[];
  codeOwnership?: CodeOwnership[];

  // 6. Development Workflow
  git?: GitConfig;
  prProcess?: PrProcess;
  testing?: TestingStrategy[];
  linting?: LintingConfig[];
  build?: BuildConfig[];
  scripts?: ProjectScript[];

  // 7. Roadmap & Planning
  roadmap?: RoadmapItem[];

  // 8. Coding Standards
  namingConventions?: NamingConvention[];
  codingStandards?: CodingStandard[];
  errorHandling?: ErrorHandlingPattern[];
  logging?: LoggingStandard;

  // 9. Documentation
  documentation?: DocumentationLink[];
  adrs?: Adr[];

  // 10. Dependencies & Integrations
  keyDependencies?: KeyDependency[];
  externalIntegrations?: ExternalIntegration[];

  // 11. Security
  security?: SecurityConfig;

  // 12. Performance & Monitoring
  performanceBudgets?: PerformanceBudget[];
  monitoring?: MonitoringConfig[];
  slas?: SlaDefinition[];

  // 13. AI Context
  ai?: AiConfig;

  // 14. Business Context
  domainConcepts?: DomainConcept[];
  userPersonas?: UserPersona[];
  businessRules?: BusinessRule[];

  // 15. Release & Versioning
  release?: ReleaseConfig;

  // 16. Operational
  runbooks?: Runbook[];

  // 17. Accessibility & i18n
  accessibility?: AccessibilityConfig;
  i18n?: InternationalizationConfig;

  // 18. Feature Flags
  featureFlags?: FeatureFlagConfig;

  // 19. Migration & Legacy
  migrations?: MigrationContext[];

  // 20. Known Issues & Tech Debt
  knownIssues?: KnownIssue[];
  techDebt?: TechDebtItem[];
}

// =============================================================================
// Main Project Interface
// =============================================================================

export interface Project {
  id: string;
  workspaceId: string;
  title: string | null;
  summary: ProjectSummary | null;
  status: ProjectStatus;
  totalCostUsd: number;
  totalTokens: number;
  sdkSessionId?: string | null;
  createdAt: number;
  updatedAt: number;

  // Indexed fields for quick access
  description: string | null;
  purpose: string | null;
  repositoryUrl: string | null;
  primaryLanguage: string | null;
  architecturePattern: ArchitecturePattern | null;

  // Rich metadata (JSON blob)
  metadata: ProjectMetadata;

  // Project setup
  directoryPath: string | null;
  setupCompleted: boolean;
}

export interface ProjectSummary {
  objective: string | null;
  completedSteps: string[];
  filesModified: string[];
  pendingIssues: string[];
  keyDecisions: string[];
}

export interface ProjectListItem {
  id: string;
  title: string | null;
  status: ProjectStatus;
  totalCostUsd: number;
  updatedAt: number;
  description: string | null;
  primaryLanguage: string | null;
  setupCompleted: boolean;
}

export interface StoredMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  agentId: string | null;
  channel?: 'chat' | 'setup' | 'plan';
  createdAt: number;
}

// Category key type for metadata updates
export type ProjectMetadataCategory = keyof ProjectMetadata;
