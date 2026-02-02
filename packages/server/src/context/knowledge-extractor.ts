import { query } from '@anthropic-ai/claude-code';
import type { MemoryCategory, MemoryEntry } from '@cloudscode/shared';
import { getMemoryStore } from './memory-store.js';
import { broadcast } from '../ws.js';
import { logger } from '../logger.js';
import { buildAuthEnv } from '../auth/build-env.js';

interface ExtractedFact {
  category: MemoryCategory;
  key: string;
  content: string;
}

export type ExtractionComplexity = 'low' | 'medium' | 'high';

const COMPLEXITY_MODELS: Record<ExtractionComplexity, string> = {
  low: 'haiku',
  medium: 'sonnet',
  high: 'opus',
};

const EXTRACTION_PROMPT = `Analyze the following text from a development session and extract reusable knowledge facts. Focus on:
- Architecture decisions and patterns
- Code conventions and standards
- Technical decisions with rationale
- Important facts about the codebase
- Known issues or gotchas

Return a JSON array of objects with these fields:
- category: one of "architecture", "convention", "decision", "fact", "issue"
- key: a short, descriptive key (2-6 words)
- content: the knowledge fact (1-3 sentences)

Only extract genuinely reusable knowledge. Skip trivial observations. Return an empty array if nothing worth extracting.

Text to analyze:
`;

class KnowledgeExtractor {
  async extract(
    workspaceId: string,
    projectId: string,
    text: string,
    complexity: ExtractionComplexity = 'low',
  ): Promise<ExtractedFact[]> {
    if (text.length < 100) return [];

    try {
      const truncatedText = text.length > 4000 ? text.slice(0, 4000) + '...' : text;
      const model = COMPLEXITY_MODELS[complexity];

      logger.debug({ model, complexity }, 'Starting knowledge extraction');

      const q = query({
        prompt: EXTRACTION_PROMPT + truncatedText,
        options: {
          model,
          maxTurns: 1,
          permissionMode: 'bypassPermissions',
          env: buildAuthEnv(),
        },
      });

      let responseText = '';
      for await (const message of q) {
        if (message.type === 'result' && message.subtype === 'success') {
          responseText = message.result ?? '';
        }
      }

      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.debug('No JSON array found in extraction response');
        return [];
      }

      const facts: ExtractedFact[] = JSON.parse(jsonMatch[0]);
      const memoryStore = getMemoryStore();
      const validCategories = new Set<MemoryCategory>([
        'architecture', 'convention', 'decision', 'fact', 'issue',
      ]);

      const stored: ExtractedFact[] = [];
      for (const fact of facts) {
        if (!validCategories.has(fact.category) || !fact.key || !fact.content) {
          continue;
        }

        // Dedup: check for similar existing entries before creating
        const similar = this.findSimilarEntry(memoryStore, workspaceId, projectId, fact);
        if (similar) {
          // Similar entry exists — update or just boost confidence
          if (fact.content.length > similar.content.length) {
            // New content is more detailed — update content and boost confidence
            memoryStore.update(similar.id, {
              content: fact.content,
              confidence: Math.min(1.0, similar.confidence + 0.05),
            });
            logger.debug({ existingId: similar.id, key: fact.key }, 'Updated existing memory entry with longer content');
          } else {
            // Existing content is sufficient — just boost confidence
            memoryStore.update(similar.id, {
              confidence: Math.min(1.0, similar.confidence + 0.05),
            });
            logger.debug({ existingId: similar.id, key: fact.key }, 'Boosted confidence of existing memory entry');
          }

          const updated = memoryStore.get(similar.id);
          if (updated) {
            broadcast({
              type: 'memory:updated',
              payload: { entry: updated, action: 'updated' },
            });
          }
          stored.push(fact);
          continue;
        }

        const entry = memoryStore.create(workspaceId, {
          category: fact.category,
          key: fact.key,
          content: fact.content,
          scope: 'project',
        }, projectId);

        stored.push(fact);

        broadcast({
          type: 'memory:updated',
          payload: { entry, action: 'created' },
        });
      }

      logger.info({ count: stored.length, workspaceId, model }, 'Knowledge facts extracted');
      return stored;
    } catch (err) {
      logger.error({ err }, 'Knowledge extraction failed');
      return [];
    }
  }

  /**
   * Finds an existing memory entry that is similar to the given fact.
   * Checks entries in the same category for key overlap: exact match
   * or >= 50% word overlap between keys.
   */
  private findSimilarEntry(
    memoryStore: ReturnType<typeof getMemoryStore>,
    workspaceId: string,
    projectId: string,
    fact: ExtractedFact,
  ): MemoryEntry | null {
    const existing = memoryStore.listByProject(workspaceId, projectId, fact.category);

    const newKeyWords = new Set(
      fact.key.toLowerCase().split(/\s+/).filter((w) => w.length > 1),
    );

    for (const entry of existing) {
      // Exact key match
      if (entry.key.toLowerCase() === fact.key.toLowerCase()) {
        return entry;
      }

      // Word overlap check
      const existingKeyWords = entry.key.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      if (existingKeyWords.length === 0) continue;

      let overlapCount = 0;
      for (const word of existingKeyWords) {
        if (newKeyWords.has(word)) overlapCount++;
      }

      const overlapRatio = overlapCount / Math.max(newKeyWords.size, existingKeyWords.length);
      if (overlapRatio >= 0.5) {
        return entry;
      }
    }

    return null;
  }
}

let extractor: KnowledgeExtractor;

export function getKnowledgeExtractor(): KnowledgeExtractor {
  if (!extractor) {
    extractor = new KnowledgeExtractor();
  }
  return extractor;
}
