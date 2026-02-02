import type { WorkflowSuggestion, WorkflowTemplate } from '@cloudscode/shared';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthInfo } from '../auth/api-key-provider.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Heuristic keyword patterns mapped to built-in template IDs
// ---------------------------------------------------------------------------

interface HeuristicPattern {
  templateId: string;
  patterns: RegExp[];
  weight: number; // base confidence boost per match
}

const HEURISTIC_PATTERNS: HeuristicPattern[] = [
  {
    templateId: 'fix-bug',
    patterns: [
      /\bfix\b.*\b(bug|issue|error|crash|broken|fail)/i,
      /\b(bug|issue|error|crash|broken)\b.*\bfix\b/i,
      /\bdebug\b/i,
      /\bnot working\b/i,
      /\bregression\b/i,
      /\bhotfix\b/i,
    ],
    weight: 0.25,
  },
  {
    templateId: 'add-feature',
    patterns: [
      /\badd\b.*\b(feature|functionality|capability|support)\b/i,
      /\bimplement\b.*\bnew\b/i,
      /\bnew\b.*\b(feature|functionality)\b/i,
      /\bbuild\b.*\b(feature|component|module)\b/i,
      /\bcreate\b.*\b(feature|functionality)\b/i,
    ],
    weight: 0.25,
  },
  {
    templateId: 'add-api-endpoint',
    patterns: [
      /\badd\b.*\b(api|endpoint|route)\b/i,
      /\bcreate\b.*\b(api|endpoint|route)\b/i,
      /\bnew\b.*\b(api|endpoint|route)\b/i,
      /\bimplement\b.*\b(api|endpoint|route)\b/i,
      /\bREST\b.*\b(endpoint|route)\b/i,
    ],
    weight: 0.3,
  },
  {
    templateId: 'refactor-component',
    patterns: [
      /\brefactor\b/i,
      /\brestructure\b/i,
      /\breorganize\b/i,
      /\bclean\s*up\b/i,
      /\bsimplify\b.*\b(component|module|code)\b/i,
      /\bmodernize\b/i,
    ],
    weight: 0.25,
  },
];

function heuristicDetect(message: string, availableTemplates: WorkflowTemplate[]): WorkflowSuggestion | null {
  const templateMap = new Map(availableTemplates.map((t) => [t.id, t]));
  let bestMatch: { templateId: string; confidence: number } | null = null;

  for (const pattern of HEURISTIC_PATTERNS) {
    if (!templateMap.has(pattern.templateId)) continue;

    let matchCount = 0;
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      const confidence = Math.min(0.5 + matchCount * pattern.weight, 0.95);
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { templateId: pattern.templateId, confidence };
      }
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.6) {
    const template = templateMap.get(bestMatch.templateId)!;
    return {
      templateId: bestMatch.templateId,
      templateName: template.name,
      confidence: bestMatch.confidence,
      reasoning: `Message matches "${template.name}" pattern with ${Math.round(bestMatch.confidence * 100)}% confidence.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// AI fallback using Claude Haiku
// ---------------------------------------------------------------------------

async function aiDetect(message: string, availableTemplates: WorkflowTemplate[]): Promise<WorkflowSuggestion | null> {
  const auth = getAuthInfo();
  if (!auth.token) return null;

  let client: Anthropic;
  if (auth.type === 'oauth') {
    client = new Anthropic({ authToken: auth.token });
  } else {
    client = new Anthropic({ apiKey: auth.token });
  }

  const templateList = availableTemplates.map((t) => `- ${t.id}: ${t.name} — ${t.description}`).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 256,
      system: `You classify user messages into workflow templates. Respond with ONLY valid JSON.

Available templates:
${templateList}

Respond in this format:
{"templateId": "...", "confidence": 0.0-1.0, "reasoning": "brief reason"}

If no template fits well (confidence < 0.5), respond: {"templateId": null, "confidence": 0, "reasoning": "no match"}`,
      messages: [{ role: 'user', content: message }],
    });

    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    const parsed = JSON.parse(text.trim());
    if (!parsed.templateId || parsed.confidence < 0.6) return null;

    const template = availableTemplates.find((t) => t.id === parsed.templateId);
    if (!template) return null;

    return {
      templateId: parsed.templateId,
      templateName: template.name,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning ?? 'AI classification',
    };
  } catch (err) {
    logger.error({ err }, 'AI intent detection failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — two-tier detection
// ---------------------------------------------------------------------------

export async function detectWorkflowIntent(
  message: string,
  availableTemplates: WorkflowTemplate[],
): Promise<WorkflowSuggestion | null> {
  if (availableTemplates.length === 0) return null;

  // Tier 1: Heuristic (instant, free)
  const heuristic = heuristicDetect(message, availableTemplates);
  if (heuristic) return heuristic;

  // Tier 2: AI fallback (cheap)
  return aiDetect(message, availableTemplates);
}
