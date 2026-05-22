import axios from 'axios';

const REQUEST_TIMEOUT_MS = Number(process.env.RESEARCH_HTTP_TIMEOUT_MS ?? 15000);
const MAX_TEXT_CHARS = Number(process.env.RESEARCH_MAX_TEXT_CHARS ?? 12000);
const RESEARCH_ALLOW_BROAD_FETCH = String(process.env.RESEARCH_ALLOW_BROAD_FETCH ?? '').trim().toLowerCase() === 'true';

const BLOCKED_DOMAIN_PATTERNS = [
  /(?:^|\.)porn/i,
  /(?:^|\.)xxx/i,
  /(?:^|\.)adult/i,
  /(?:^|\.)sex/i,
  /(?:^|\.)escort/i,
  /(?:^|\.)bet/i,
  /(?:^|\.)casino/i,
  /(?:^|\.)gambl/i,
  /(?:^|\.)malware/i,
  /(?:^|\.)phish/i,
  /(?:^|\.)torrent/i,
  /(?:^|\.)pirate/i,
];

const NZ_FOCUSED_DOMAINS = [
  'govt.nz',
  'gov.nz',
  'org.nz',
  'ac.nz',
  'co.nz',
  'nz',
];

const TRUSTED_OFFICIAL_DOMAINS = [
  'supabase.com',
  'railway.app',
  'nodejs.org',
  'developer.mozilla.org',
  'typescriptlang.org',
  'vite.dev',
  'react.dev',
  'deno.com',
  'docs.github.com',
  'github.com',
  'npmjs.com',
];

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const loweredHost = hostname.toLowerCase();
  const loweredDomain = domain.toLowerCase();
  return loweredHost === loweredDomain || loweredHost.endsWith(`.${loweredDomain}`);
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered === '127.0.0.1' || lowered === '::1') {
    return true;
  }

  if (/^10\./.test(lowered) || /^192\.168\./.test(lowered) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lowered)) {
    return true;
  }

  return false;
}

export function isBlockedResearchDomain(hostname: string): boolean {
  return BLOCKED_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function isTrustedResearchDomain(hostname: string): boolean {
  return [...NZ_FOCUSED_DOMAINS, ...TRUSTED_OFFICIAL_DOMAINS].some((domain) => hostnameMatchesDomain(hostname, domain));
}

export function buildPrioritizedResearchQueries(query: string): string[] {
  const normalizedQuery = query.trim();
  const riskyTermsExclusion = '-porn -xxx -adult -escort -casino -betting -gambling -torrent';

  const nzStage = `${normalizedQuery} (${NZ_FOCUSED_DOMAINS.map((domain) => `site:${domain}`).join(' OR ')}) ${riskyTermsExclusion}`;
  const officialStage = `${normalizedQuery} (${TRUSTED_OFFICIAL_DOMAINS.map((domain) => `site:${domain}`).join(' OR ')}) ${riskyTermsExclusion}`;

  return [nzStage, officialStage];
}

function truncate(value: string, max = MAX_TEXT_CHARS): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}\n\n[TRUNCATED]`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSerperResult(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const payload = data as {
    answerBox?: { snippet?: string; answer?: string };
    knowledgeGraph?: { description?: string };
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const lines: string[] = [];

  if (payload.answerBox?.answer) {
    lines.push(`Answer: ${payload.answerBox.answer}`);
  }

  if (payload.answerBox?.snippet) {
    lines.push(`Snippet: ${payload.answerBox.snippet}`);
  }

  if (payload.knowledgeGraph?.description) {
    lines.push(`Knowledge Graph: ${payload.knowledgeGraph.description}`);
  }

  for (const item of payload.organic ?? []) {
    const title = String(item.title ?? '').trim();
    const link = String(item.link ?? '').trim();
    const snippet = String(item.snippet ?? '').trim();
    if (!title && !link && !snippet) {
      continue;
    }

    lines.push(`- ${title || 'Untitled'}\n  ${link}\n  ${snippet}`);
  }

  return lines.join('\n').trim();
}

function extractDuckDuckGoSnippets(html: string): string {
  const snippets = Array.from(html.matchAll(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi));

  const rows: string[] = [];
  for (const match of snippets.slice(0, 8)) {
    const title = stripHtml(match[1] ?? '');
    const snippet = stripHtml(match[2] ?? '');
    if (!title && !snippet) {
      continue;
    }
    rows.push(`- ${title}\n  ${snippet}`);
  }

  return rows.join('\n').trim();
}

function validateHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported');
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('Private/local hosts are not allowed for research fetch');
  }

  if (isBlockedResearchDomain(parsed.hostname)) {
    throw new Error('Blocked domain category for research fetch');
  }

  if (!RESEARCH_ALLOW_BROAD_FETCH && !isTrustedResearchDomain(parsed.hostname)) {
    throw new Error('Domain is not in trusted official research allowlist');
  }

  return parsed.toString();
}

export async function executeWebSearch(query: string): Promise<string> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('Search query is required');
  }

  const proxyUrl = String(process.env.RESEARCH_SEARCH_PROXY_URL ?? '').trim();
  if (proxyUrl) {
    const response = await axios.get(proxyUrl, {
      params: { q: normalizedQuery },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (typeof response.data === 'string') {
      return truncate(stripHtml(response.data));
    }

    return truncate(JSON.stringify(response.data, null, 2));
  }

  const serperApiKey = String(process.env.SERPER_API_KEY ?? '').trim();
  if (serperApiKey) {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: normalizedQuery },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'X-API-KEY': serperApiKey,
          'Content-Type': 'application/json',
        },
      },
    );

    const parsed = parseSerperResult(response.data);
    return truncate(parsed || JSON.stringify(response.data, null, 2));
  }

  const duckResponse = await axios.get('https://duckduckgo.com/html/', {
    params: { q: normalizedQuery },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
  });

  const snippets = extractDuckDuckGoSnippets(String(duckResponse.data ?? ''));
  if (snippets) {
    return truncate(snippets);
  }

  return truncate(stripHtml(String(duckResponse.data ?? '')));
}

export async function fetchWebpageContent(url: string): Promise<string> {
  const safeUrl = validateHttpUrl(url.trim());

  const response = await axios.get(safeUrl, {
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'text',
    headers: {
      'User-Agent': 'FieldOps-Bob-ResearchAgent/1.0 (+https://fieldops.local)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxContentLength: 2_000_000,
    maxBodyLength: 2_000_000,
  });

  const html = String(response.data ?? '');
  const content = stripHtml(html);

  if (!content) {
    return 'No readable text extracted from page.';
  }

  return truncate(content);
}
