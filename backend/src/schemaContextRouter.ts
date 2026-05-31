type SchemaRouterOptions = {
  intentText: string;
  masterSchemaPayload: string;
  maxBytes?: number;
};

type PromptGuardrailOptions = {
  maxContextBytes: number;
  strictMode: boolean;
  fallbackAction: 'truncate_blueprints' | 'truncate_prompt';
};

type PromptGuardrailResult = {
  systemPrompt: string;
  userMessage: string;
  totalBytesBefore: number;
  totalBytesAfter: number;
  truncated: boolean;
};

type SchemaRouterResult = {
  portalType: string;
  activeTables: string[];
  minimizedSchema: string;
  source: 'filtered' | 'fallback';
  bytes: number;
  truncated: boolean;
};

const DEFAULT_SCHEMA_BYTES = 4096;

const DOMAIN_TABLES: Record<string, string[]> = {
  biosecurity: ['biosecurity_jobs', 'biosecurity_assessments', 'biosecurity_notices', 'zones', 'properties'],
  smoke_assessment: ['smoke_jobs', 'smoke_assessments', 'smoke_notices', 'zones', 'properties'],
  compliance: ['smoke_assessments', 'noise_assessments', 'noise_notices', 'zones', 'properties'],
  access_control: ['access_control_incidents', 'access_credentials', 'vehicle_plates', 'zones', 'properties'],
  operations: ['incidents', 'observations', 'organizations', 'user_profiles', 'zones', 'properties'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || !value) return '';
  if (utf8Bytes(value) <= maxBytes) return value;

  let low = 0;
  let high = value.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const sample = value.slice(0, mid);
    if (utf8Bytes(sample) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return value.slice(0, low);
}

export function inferPortalTypeFromIntent(intentText: string): string {
  const normalized = String(intentText || '').toLowerCase();

  if (/biosecurity|chilean\s+needlegrass|weed|flora/.test(normalized)) {
    return 'biosecurity';
  }
  if (/compliance|bylaw/.test(normalized)) {
    return 'compliance';
  }
  if (/smoke|noise/.test(normalized)) {
    return 'smoke_assessment';
  }
  if (/access\s+control|credential|plate|vehicle\s+gate/.test(normalized)) {
    return 'access_control';
  }

  return 'operations';
}

export function serializeTablesFromMasterSchema(masterSchemaPayload: string, tables: string[]): { text: string; source: 'filtered' | 'fallback' } {
  const payload = String(masterSchemaPayload || '').trim();
  const selectedTables = Array.from(new Set(tables.map((table) => table.trim()).filter(Boolean)));

  if (!payload || /unavailable/i.test(payload)) {
    return {
      text: [
        'Schema blueprint unavailable in Tier A context.',
        `Active tables: ${selectedTables.join(', ')}`,
      ].join('\n'),
      source: 'fallback',
    };
  }

  const regexes = selectedTables.map((table) => new RegExp(`\\b${escapeRegExp(table)}\\b`, 'i'));
  const lines = payload.split(/\r?\n/);
  const matchedLines = lines.filter((line) => regexes.some((regex) => regex.test(line)));

  if (matchedLines.length === 0) {
    return {
      text: [
        'Schema-Aware Context Paging active (table-level fallback).',
        `Active tables: ${selectedTables.join(', ')}`,
      ].join('\n'),
      source: 'fallback',
    };
  }

  return {
    text: [
      'Schema-Aware Context Paging active (filtered blueprint).',
      `Active tables: ${selectedTables.join(', ')}`,
      '---',
      matchedLines.join('\n'),
    ].join('\n'),
    source: 'filtered',
  };
}

export function buildSchemaAwareBlueprint(options: SchemaRouterOptions): SchemaRouterResult {
  const portalType = inferPortalTypeFromIntent(options.intentText);
  const activeTables = DOMAIN_TABLES[portalType] ?? DOMAIN_TABLES.operations;
  const maxBytes = Math.max(512, Number(options.maxBytes ?? DEFAULT_SCHEMA_BYTES));
  const serialized = serializeTablesFromMasterSchema(options.masterSchemaPayload, activeTables);

  const beforeBytes = utf8Bytes(serialized.text);
  const minimizedSchema = beforeBytes > maxBytes
    ? `${truncateUtf8(serialized.text, Math.max(0, maxBytes - 64))}\n\n[TRUNCATED_BLUEPRINTS due to max byte policy]`
    : serialized.text;

  return {
    portalType,
    activeTables,
    minimizedSchema,
    source: serialized.source,
    bytes: utf8Bytes(minimizedSchema),
    truncated: beforeBytes > maxBytes,
  };
}

export function applyPromptGuardrails(systemPrompt: string, userMessage: string, options: PromptGuardrailOptions): PromptGuardrailResult {
  const normalizedSystem = String(systemPrompt || '');
  let normalizedUser = String(userMessage || '');

  const totalBefore = utf8Bytes(normalizedSystem) + utf8Bytes(normalizedUser);
  if (!options.strictMode || totalBefore <= options.maxContextBytes) {
    return {
      systemPrompt: normalizedSystem,
      userMessage: normalizedUser,
      totalBytesBefore: totalBefore,
      totalBytesAfter: totalBefore,
      truncated: false,
    };
  }

  if (options.fallbackAction === 'truncate_blueprints') {
    const markerRegex = /Reference Blueprints \(Tier A\):[\s\S]*?(System Operational Rules:)/i;
    if (markerRegex.test(normalizedUser)) {
      normalizedUser = normalizedUser.replace(
        markerRegex,
        'Reference Blueprints (Tier A): [TRUNCATED_BLUEPRINTS due to strict byte policy]\n$1',
      );
    }
  }

  const remainingBytes = Math.max(256, options.maxContextBytes - utf8Bytes(normalizedSystem));
  if (utf8Bytes(normalizedUser) > remainingBytes) {
    normalizedUser = `${truncateUtf8(normalizedUser, Math.max(0, remainingBytes - 64))}\n\n[TRUNCATED_PROMPT due to strict byte policy]`;
  }

  const totalAfter = utf8Bytes(normalizedSystem) + utf8Bytes(normalizedUser);
  return {
    systemPrompt: normalizedSystem,
    userMessage: normalizedUser,
    totalBytesBefore: totalBefore,
    totalBytesAfter: totalAfter,
    truncated: true,
  };
}