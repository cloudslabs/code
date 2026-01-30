import { query } from '@anthropic-ai/claude-code';
import type { MemoryCategory } from '@cloudscode/shared';
import { getMemoryStore } from './memory-store.js';
import { broadcast } from '../ws.js';
import { logger } from '../logger.js';

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
}

let extractor: KnowledgeExtractor;

export function getKnowledgeExtractor(): KnowledgeExtractor {
  if (!extractor) {
    extractor = new KnowledgeExtractor();
  }
  return extractor;
}
