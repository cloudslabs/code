import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, RefreshCw, Code, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store.js';
import { api } from '../../lib/api-client.js';
import type { Project, ProjectMetadata, ProjectMetadataCategory } from '@cloudscode/shared';

type EditorTab = 'overview' | 'architecture' | 'structure' | 'services' | 'conventions' | 'roadmap' | 'ai';

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'structure', label: 'Structure' },
  { id: 'services', label: 'Services' },
  { id: 'conventions', label: 'Conventions' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'ai', label: 'AI Config' },
];

export function ProjectEditor() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeTab, setActiveTab] = useState<EditorTab>('overview');
  const [project, setProject] = useState<Project | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [agentUpdated, setAgentUpdated] = useState(false);
  const agentUpdateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevMetadataRef = useRef<string>('');

  const showAgentBanner = useCallback(() => {
    setAgentUpdated(true);
    if (agentUpdateTimer.current) clearTimeout(agentUpdateTimer.current);
    agentUpdateTimer.current = setTimeout(() => setAgentUpdated(false), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (agentUpdateTimer.current) clearTimeout(agentUpdateTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeProject) {
      const newMetaStr = JSON.stringify(activeProject.metadata);
      const isAgentUpdate = prevMetadataRef.current !== '' && prevMetadataRef.current !== newMetaStr;
      prevMetadataRef.current = newMetaStr;

      // Don't auto-sync while saving to avoid overwriting user edits
      if (saving) {
        if (isAgentUpdate) showAgentBanner();
        return;
      }

      setProject({ ...activeProject });
      setRawJson(JSON.stringify(activeProject.metadata, null, 2));
      if (isAgentUpdate) showAgentBanner();
    }
  }, [activeProject, saving, showAgentBanner]);

  if (!project) {
    return (
      <div className="p-6 text-zinc-500 text-center">
        Select a project to edit its settings
      </div>
    );
  }

  const metadata = project.metadata;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (rawMode) {
        const parsed = JSON.parse(rawJson);
        await api.updateProject(project.id, { metadata: parsed });
      } else {
        await api.updateProject(project.id, {
          title: project.title,
          description: project.description,
          purpose: project.purpose,
          repositoryUrl: project.repositoryUrl,
          primaryLanguage: project.primaryLanguage,
          architecturePattern: project.architecturePattern,
        });
        // Save metadata categories that were edited
        for (const key of Object.keys(metadata) as ProjectMetadataCategory[]) {
          if (metadata[key] !== undefined) {
            await api.updateProjectMetadata(project.id, key, metadata[key]);
          }
        }
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const { metadata: scanned } = await api.scanProject(project.id);
      setProject((prev) => prev ? { ...prev, metadata: { ...prev.metadata, ...scanned } } : prev);
      setRawJson(JSON.stringify({ ...metadata, ...scanned }, null, 2));
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanning(false);
    }
  };

  const updateField = (field: keyof Project, value: unknown) => {
    setProject((prev) => prev ? { ...prev, [field]: value } : prev);
  };

  const updateMetadata = (key: keyof ProjectMetadata, value: unknown) => {
    setProject((prev) => {
      if (!prev) return prev;
      return { ...prev, metadata: { ...prev.metadata, [key]: value } };
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Agent update banner */}
      {agentUpdated && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-900/30 border-b border-blue-800/50 text-blue-300 text-xs animate-pulse">
          <Bot size={12} />
          Settings updated by agent
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-200">Project Settings</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRawMode(!rawMode)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors"
            title="Toggle JSON editor"
          >
            <Code size={12} />
            {rawMode ? 'Form' : 'JSON'}
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
            Scan
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
          >
            <Save size={12} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {rawMode ? (
        <div className="flex-1 p-4">
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="w-full h-full bg-zinc-900 text-zinc-300 text-xs font-mono p-3 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none resize-none"
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b border-zinc-800 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-xs whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'text-zinc-100 border-b-2 border-blue-500'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'overview' && (
              <OverviewSection project={project} updateField={updateField} />
            )}
            {activeTab === 'architecture' && (
              <ArchitectureSection metadata={metadata} updateMetadata={updateMetadata} project={project} updateField={updateField} />
            )}
            {activeTab === 'structure' && (
              <StructureSection metadata={metadata} updateMetadata={updateMetadata} />
            )}
            {activeTab === 'services' && (
              <ServicesSection metadata={metadata} updateMetadata={updateMetadata} />
            )}
            {activeTab === 'conventions' && (
              <ConventionsSection metadata={metadata} updateMetadata={updateMetadata} />
            )}
            {activeTab === 'roadmap' && (
              <RoadmapSection metadata={metadata} updateMetadata={updateMetadata} />
            )}
            {activeTab === 'ai' && (
              <AiSection metadata={metadata} updateMetadata={updateMetadata} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared Components
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-400 block">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none resize-none"
    />
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-850 transition-colors rounded-t-lg"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Sections
// ---------------------------------------------------------------------------

function OverviewSection({ project, updateField }: { project: Project; updateField: (f: keyof Project, v: unknown) => void }) {
  return (
    <>
      <Field label="Name">
        <TextInput value={project.title ?? ''} onChange={(v) => updateField('title', v || null)} placeholder="Project name" />
      </Field>
      <Field label="Description">
        <TextArea value={project.description ?? ''} onChange={(v) => updateField('description', v || null)} placeholder="Brief description" />
      </Field>
      <Field label="Purpose">
        <TextArea value={project.purpose ?? ''} onChange={(v) => updateField('purpose', v || null)} placeholder="What is this project for?" />
      </Field>
      <Field label="Status">
        <select
          value={project.status}
          onChange={(e) => updateField('status', e.target.value)}
          className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="active">Active</option>
          <option value="planning">Planning</option>
          <option value="paused">Paused</option>
          <option value="maintenance">Maintenance</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </Field>
      <Field label="Repository URL">
        <TextInput value={project.repositoryUrl ?? ''} onChange={(v) => updateField('repositoryUrl', v || null)} placeholder="https://github.com/..." />
      </Field>
      <Field label="Tags">
        <TextInput
          value={(project.metadata.tags ?? []).join(', ')}
          onChange={() => {/* handled in save */}}
          placeholder="Comma-separated tags"
        />
      </Field>
    </>
  );
}

function ArchitectureSection({ metadata, updateMetadata, project, updateField }: {
  metadata: ProjectMetadata;
  updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void;
  project: Project;
  updateField: (f: keyof Project, v: unknown) => void;
}) {
  return (
    <>
      <Field label="Primary Language">
        <TextInput value={project.primaryLanguage ?? ''} onChange={(v) => updateField('primaryLanguage', v || null)} placeholder="TypeScript" />
      </Field>
      <Field label="Architecture Pattern">
        <select
          value={project.architecturePattern ?? ''}
          onChange={(e) => updateField('architecturePattern', e.target.value || null)}
          className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="">Not set</option>
          <option value="monolith">Monolith</option>
          <option value="modular_monolith">Modular Monolith</option>
          <option value="microservices">Microservices</option>
          <option value="serverless">Serverless</option>
          <option value="event_driven">Event Driven</option>
          <option value="layered">Layered</option>
          <option value="hexagonal">Hexagonal</option>
          <option value="cqrs">CQRS</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <Section title="Tech Stack">
        <div className="text-xs text-zinc-500">
          {metadata.techStack && metadata.techStack.length > 0 ? (
            <div className="space-y-1">
              {metadata.techStack.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-zinc-300">
                  <span className="font-medium">{t.name}</span>
                  {t.version && <span className="text-zinc-500">{t.version}</span>}
                  <span className="text-zinc-600">({t.role})</span>
                </div>
              ))}
            </div>
          ) : (
            'No tech stack detected. Click Scan to auto-detect.'
          )}
        </div>
      </Section>
      <Section title="Design Patterns" defaultOpen={false}>
        <div className="text-xs text-zinc-500">
          {metadata.designPatterns && metadata.designPatterns.length > 0 ? (
            <div className="space-y-1">
              {metadata.designPatterns.map((p, i) => (
                <div key={i}>
                  <span className="text-zinc-300 font-medium">{p.name}</span>: {p.description}
                </div>
              ))}
            </div>
          ) : (
            'No design patterns detected. Click Scan to auto-detect.'
          )}
        </div>
      </Section>
    </>
  );
}

function StructureSection({ metadata, updateMetadata }: { metadata: ProjectMetadata; updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void }) {
  return (
    <>
      <Field label="Package Manager">
        <select
          value={metadata.packageManager ?? ''}
          onChange={(e) => updateMetadata('packageManager', e.target.value || undefined)}
          className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="">Not set</option>
          <option value="npm">npm</option>
          <option value="pnpm">pnpm</option>
          <option value="yarn">yarn</option>
          <option value="bun">bun</option>
        </select>
      </Field>
      <Field label="Monorepo Tool">
        <select
          value={metadata.monorepoTool ?? 'none'}
          onChange={(e) => updateMetadata('monorepoTool', e.target.value)}
          className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="none">None</option>
          <option value="turborepo">Turborepo</option>
          <option value="nx">Nx</option>
          <option value="lerna">Lerna</option>
          <option value="rush">Rush</option>
        </select>
      </Field>
      <Section title="Folder Mappings">
        <div className="text-xs text-zinc-500 space-y-1">
          {metadata.folderMappings && metadata.folderMappings.length > 0 ? (
            metadata.folderMappings.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-zinc-300">
                <code className="text-blue-400">{f.path}/</code>
                <span className="text-zinc-500">{f.purpose}</span>
              </div>
            ))
          ) : (
            'No folder mappings. Click Scan to auto-detect.'
          )}
        </div>
      </Section>
      <Section title="Entry Points" defaultOpen={false}>
        <div className="text-xs text-zinc-500 space-y-1">
          {metadata.entryPoints && metadata.entryPoints.length > 0 ? (
            metadata.entryPoints.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-zinc-300">
                <code className="text-blue-400">{e.path}</code>
                <span className="text-zinc-600">({e.type})</span>
              </div>
            ))
          ) : (
            'No entry points detected. Click Scan to auto-detect.'
          )}
        </div>
      </Section>
    </>
  );
}

function ServicesSection({ metadata, updateMetadata }: { metadata: ProjectMetadata; updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void }) {
  return (
    <>
      <Section title="Services">
        <div className="text-xs text-zinc-500">
          {metadata.services && metadata.services.length > 0 ? (
            <div className="space-y-1">
              {metadata.services.map((s, i) => (
                <div key={i} className="text-zinc-300">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-zinc-500"> ({s.type})</span>
                  {s.description && <span className="text-zinc-600"> - {s.description}</span>}
                </div>
              ))}
            </div>
          ) : (
            'No services defined.'
          )}
        </div>
      </Section>
      <Section title="Databases" defaultOpen={false}>
        <div className="text-xs text-zinc-500">
          {metadata.databases && metadata.databases.length > 0 ? (
            metadata.databases.map((d, i) => (
              <div key={i} className="text-zinc-300">
                {d.name} ({d.type})
              </div>
            ))
          ) : (
            'No databases configured.'
          )}
        </div>
      </Section>
      <Section title="Environments" defaultOpen={false}>
        <div className="text-xs text-zinc-500">
          {metadata.environments && metadata.environments.length > 0 ? (
            metadata.environments.map((e, i) => (
              <div key={i} className="text-zinc-300">
                {e.name} {e.url && <span className="text-zinc-500">({e.url})</span>}
              </div>
            ))
          ) : (
            'No environments configured.'
          )}
        </div>
      </Section>
    </>
  );
}

function ConventionsSection({ metadata, updateMetadata }: { metadata: ProjectMetadata; updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void }) {
  return (
    <>
      <Section title="Naming Conventions">
        <div className="text-xs text-zinc-500">
          {metadata.namingConventions && metadata.namingConventions.length > 0 ? (
            metadata.namingConventions.map((n, i) => (
              <div key={i} className="text-zinc-300">
                <span className="font-medium">{n.target}</span>: {n.pattern}
                {n.example && <span className="text-zinc-500"> (e.g., {n.example})</span>}
              </div>
            ))
          ) : (
            'No naming conventions defined.'
          )}
        </div>
      </Section>
      <Section title="Coding Standards">
        <div className="text-xs text-zinc-500">
          {metadata.codingStandards && metadata.codingStandards.length > 0 ? (
            metadata.codingStandards.map((s, i) => (
              <div key={i} className="text-zinc-300">
                <span className="font-medium">{s.rule}</span>: {s.description}
              </div>
            ))
          ) : (
            'No coding standards defined.'
          )}
        </div>
      </Section>
      <Section title="Error Handling" defaultOpen={false}>
        <div className="text-xs text-zinc-500">
          {metadata.errorHandling && metadata.errorHandling.length > 0 ? (
            metadata.errorHandling.map((e, i) => (
              <div key={i} className="text-zinc-300">
                <span className="font-medium">{e.context}</span>: {e.pattern}
              </div>
            ))
          ) : (
            'No error handling patterns defined.'
          )}
        </div>
      </Section>
      <Section title="Logging" defaultOpen={false}>
        <div className="text-xs text-zinc-500">
          {metadata.logging ? (
            <div className="text-zinc-300">
              Framework: {metadata.logging.framework}
              {metadata.logging.guidelines && <div className="mt-1">{metadata.logging.guidelines}</div>}
            </div>
          ) : (
            'No logging standards defined.'
          )}
        </div>
      </Section>
    </>
  );
}

function RoadmapSection({ metadata, updateMetadata }: { metadata: ProjectMetadata; updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void }) {
  return (
    <Section title="Roadmap Items">
      <div className="text-xs text-zinc-500">
        {metadata.roadmap && metadata.roadmap.length > 0 ? (
          <div className="space-y-2">
            {metadata.roadmap.map((item, i) => (
              <div key={i} className="p-2 rounded bg-zinc-900 border border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    item.status === 'completed' ? 'bg-green-900 text-green-300' :
                    item.status === 'in_progress' ? 'bg-blue-900 text-blue-300' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {item.status}
                  </span>
                  <span className="text-zinc-300 font-medium">{item.title}</span>
                  <span className="text-zinc-600">({item.type})</span>
                </div>
                {item.description && (
                  <div className="mt-1 text-zinc-500">{item.description}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          'No roadmap items. Add milestones, epics, and features to track progress.'
        )}
      </div>
    </Section>
  );
}

function AiSection({ metadata, updateMetadata }: { metadata: ProjectMetadata; updateMetadata: (k: keyof ProjectMetadata, v: unknown) => void }) {
  const ai = metadata.ai ?? {};

  const updateAi = (field: string, value: unknown) => {
    updateMetadata('ai', { ...ai, [field]: value });
  };

  return (
    <>
      <Field label="Custom Instructions">
        <TextArea
          value={ai.customInstructions ?? ''}
          onChange={(v) => updateAi('customInstructions', v || undefined)}
          placeholder="Special instructions for the AI when working on this project..."
          rows={4}
        />
      </Field>
      <Field label="Avoid Paths (one per line)">
        <TextArea
          value={(ai.avoidPaths ?? []).join('\n')}
          onChange={(v) => updateAi('avoidPaths', v ? v.split('\n').map((s) => s.trim()).filter(Boolean) : undefined)}
          placeholder="node_modules&#10;dist&#10;.git"
          rows={3}
        />
      </Field>
      <Field label="Focus Paths (one per line)">
        <TextArea
          value={(ai.focusPaths ?? []).join('\n')}
          onChange={(v) => updateAi('focusPaths', v ? v.split('\n').map((s) => s.trim()).filter(Boolean) : undefined)}
          placeholder="src&#10;packages"
          rows={3}
        />
      </Field>
      <Section title="Code Generation Preferences" defaultOpen={false}>
        <Field label="Comment Style">
          <select
            value={ai.codeGenPreferences?.commentStyle ?? 'minimal'}
            onChange={(e) => updateAi('codeGenPreferences', { ...ai.codeGenPreferences, commentStyle: e.target.value })}
            className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="minimal">Minimal</option>
            <option value="moderate">Moderate</option>
            <option value="verbose">Verbose</option>
          </select>
        </Field>
        <Field label="Test Generation">
          <select
            value={ai.codeGenPreferences?.testGeneration ?? 'on_request'}
            onChange={(e) => updateAi('codeGenPreferences', { ...ai.codeGenPreferences, testGeneration: e.target.value })}
            className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="always">Always</option>
            <option value="on_request">On Request</option>
            <option value="never">Never</option>
          </select>
        </Field>
        <Field label="Type Annotations">
          <select
            value={ai.codeGenPreferences?.typeAnnotations ?? 'moderate'}
            onChange={(e) => updateAi('codeGenPreferences', { ...ai.codeGenPreferences, typeAnnotations: e.target.value })}
            className="w-full bg-zinc-900 text-zinc-300 text-sm px-3 py-1.5 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="strict">Strict</option>
            <option value="moderate">Moderate</option>
            <option value="inferred">Inferred</option>
          </select>
        </Field>
      </Section>
    </>
  );
}
