import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type IndexCoverageRow = {
  schema_name: string;
  table_name: string;
  estimated_rows: number | string | null;
  seq_scan: number | string | null;
  idx_scan: number | string | null;
  index_count: number | string | null;
  lacks_indexes: boolean;
};

type SortHotspotRow = {
  queryid: string | null;
  calls: number | string | null;
  total_exec_time: number | string | null;
  mean_exec_time: number | string | null;
  rows: number | string | null;
  shared_blks_read: number | string | null;
  temp_blks_written: number | string | null;
  query_excerpt: string;
};

type MissingFkIndexRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  fk_columns: string | string[];
};

type RiskRewardRow = {
  candidate: string;
  reward: string;
  risk: string;
  recommendation: 'High priority' | 'Medium priority' | 'Low priority';
  priorityScore: number;
};

type OptimizationCandidate = {
  category: 'index_coverage' | 'sort_hotspot' | 'foreign_key_index_gap';
  schema: string;
  table: string;
  detail: string;
  riskLevel: 'low' | 'medium' | 'high';
  rewardLevel: 'low' | 'medium' | 'high';
  priorityScore: number;
};

type RiskLevel = OptimizationCandidate['riskLevel'];
type RewardLevel = OptimizationCandidate['rewardLevel'];

type SchemaAuditResult = {
  generatedAt: string;
  source: 'pg_catalog' | 'postgrest_catalog' | 'rpc_catalog';
  metadata: {
    pgStatStatementsAvailable: boolean;
  };
  indexCoverageCandidates: OptimizationCandidate[];
  sortHotspots: OptimizationCandidate[];
  riskRewardMatrix: RiskRewardRow[];
  optimizationCandidates: OptimizationCandidate[];
};

type RpcAuditPayload = {
  generatedAt?: string;
  source?: string;
  metadata?: { pgStatStatementsAvailable?: boolean };
  indexCoverageCandidates?: OptimizationCandidate[];
  sortHotspots?: OptimizationCandidate[];
  riskRewardMatrix?: RiskRewardRow[];
  optimizationCandidates?: OptimizationCandidate[];
};

type SupabaseCatalogTableRow = {
  schemaname?: string;
  relname?: string;
  tablename?: string;
  n_live_tup?: number | string | null;
  seq_scan?: number | string | null;
  idx_scan?: number | string | null;
};

const CURRENT_FILE = fileURLToPath(import.meta.url);
const SRC_DIR = path.dirname(CURRENT_FILE);
const BACKEND_DIR = path.resolve(SRC_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');

let extraEnvLoaded = false;

function loadExtraEnvSources(): void {
  if (extraEnvLoaded) return;
  extraEnvLoaded = true;

  const envFiles = [
    path.join(REPO_ROOT, '.env'),
    path.join(REPO_ROOT, '.env.local'),
    path.join(REPO_ROOT, '.env.playwright.local'),
    path.join(BACKEND_DIR, '.env'),
  ];

  for (const filePath of envFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;

      const delimiterIndex = line.indexOf('=');
      const key = line.slice(0, delimiterIndex).trim();
      const value = line.slice(delimiterIndex + 1).trim().replace(/^['"]|['"]$/g, '');

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

const INDEX_COVERAGE_SQL = `
SELECT
  st.schemaname AS schema_name,
  st.relname AS table_name,
  st.n_live_tup::bigint AS estimated_rows,
  st.seq_scan::bigint AS seq_scan,
  st.idx_scan::bigint AS idx_scan,
  COALESCE(ix.index_count, 0)::bigint AS index_count,
  (COALESCE(ix.index_count, 0) = 0) AS lacks_indexes
FROM pg_stat_user_tables st
LEFT JOIN (
  SELECT
    schemaname,
    tablename,
    COUNT(*)::bigint AS index_count
  FROM pg_indexes
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  GROUP BY schemaname, tablename
) ix
  ON ix.schemaname = st.schemaname
 AND ix.tablename = st.relname
WHERE st.schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY lacks_indexes DESC, st.seq_scan DESC, st.n_live_tup DESC;
`;

const HAS_PG_STAT_STATEMENTS_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM pg_extension
  WHERE extname = 'pg_stat_statements'
) AS available;
`;

const SORT_HOTSPOT_SQL = `
SELECT
  queryid::text,
  calls::bigint,
  total_exec_time,
  mean_exec_time,
  rows::bigint,
  shared_blks_read::bigint,
  temp_blks_written::bigint,
  LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 220) AS query_excerpt
FROM pg_stat_statements
WHERE LOWER(query) LIKE '% order by %'
ORDER BY temp_blks_written DESC, shared_blks_read DESC, total_exec_time DESC
LIMIT 100;
`;

const MISSING_FK_INDEX_SQL = `
WITH fk AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    con.conname AS constraint_name,
    ARRAY_AGG(a.attname ORDER BY key_cols.ord) AS fk_columns
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN LATERAL UNNEST(con.conkey) WITH ORDINALITY AS key_cols(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_cols.attnum
  WHERE con.contype = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  GROUP BY n.nspname, c.relname, con.conname
),
idx AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    i.relname AS index_name,
    ARRAY_AGG(a.attname ORDER BY key_cols.ord) AS index_columns
  FROM pg_index ix
  JOIN pg_class c ON c.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN LATERAL UNNEST(ix.indkey) WITH ORDINALITY AS key_cols(attnum, ord) ON key_cols.attnum > 0
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_cols.attnum
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ix.indisvalid = true
  GROUP BY n.nspname, c.relname, i.relname
)
SELECT
  fk.schema_name,
  fk.table_name,
  fk.constraint_name,
  fk.fk_columns
FROM fk
WHERE NOT EXISTS (
  SELECT 1
  FROM idx
  WHERE idx.schema_name = fk.schema_name
    AND idx.table_name = fk.table_name
    AND idx.index_columns[1:array_length(fk.fk_columns, 1)] = fk.fk_columns
)
ORDER BY fk.schema_name, fk.table_name, fk.constraint_name;
`;

function firstDefinedEnv(keys: string[]): string {
  loadExtraEnvSources();

  for (const key of keys) {
    const value = String(process.env[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parsePgTextArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  const trimmed = String(value ?? '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return trimmed ? [trimmed] : [];
  }
  const body = trimmed.slice(1, -1);
  if (!body) return [];
  return body.split(',').map((token) => token.replace(/^"|"$/g, '').trim()).filter(Boolean);
}

function getDbConnectionConfig(): { connectionString?: string; host?: string; port?: number; user?: string; password?: string; database?: string; ssl?: { rejectUnauthorized: boolean } } {
  const connectionString = firstDefinedEnv([
    'SUPABASE_DB_URL',
    'SUPABASE_DB_POOLER_URL',
    'SUPABASE_DB_POOLER_CONNECTION_STRING',
    'DATABASE_URL',
    'POSTGRES_URL',
    'POSTGRES_CONNECTION_STRING',
  ]);

  if (connectionString) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }

  const host = firstDefinedEnv(['PGHOST', 'POSTGRES_HOST', 'SUPABASE_DB_HOST']);
  const user = firstDefinedEnv(['PGUSER', 'POSTGRES_USER', 'SUPABASE_DB_USER']);
  const password = firstDefinedEnv(['PGPASSWORD', 'POSTGRES_PASSWORD', 'SUPABASE_DB_PASSWORD']);
  const database = firstDefinedEnv(['PGDATABASE', 'POSTGRES_DB', 'SUPABASE_DB_NAME']);
  const portRaw = firstDefinedEnv(['PGPORT', 'POSTGRES_PORT', 'SUPABASE_DB_PORT']);
  const port = portRaw ? Number(portRaw) : undefined;

  if (!host || !user || !password || !database) {
    throw new Error(
      'Missing database connection settings. Provide SUPABASE_DB_URL (or DATABASE_URL/PG* variables) so Bob can query pg_catalog views directly.'
    );
  }

  return {
    host,
    user,
    password,
    database,
    port: Number.isFinite(port) ? port : 5432,
    ssl: { rejectUnauthorized: false },
  };
}

function buildIndexCoverageCandidates(rows: IndexCoverageRow[]): OptimizationCandidate[] {
  return rows
    .filter((row) => row.lacks_indexes || toNumber(row.seq_scan) > toNumber(row.idx_scan) * 3)
    .map((row) => {
      const estimatedRows = toNumber(row.estimated_rows);
      const seqScan = toNumber(row.seq_scan);
      const idxScan = toNumber(row.idx_scan);
      const noIndexes = Boolean(row.lacks_indexes);
      const highVolume = estimatedRows > 10000;
      const riskLevel: RiskLevel = highVolume ? 'high' : 'medium';
      const rewardLevel: RewardLevel = highVolume ? 'high' : 'medium';
      const priorityScore = (noIndexes ? 70 : 35) + (highVolume ? 20 : 0) + Math.min(10, Math.floor(seqScan / 1000));

      return {
        category: 'index_coverage' as const,
        schema: row.schema_name,
        table: row.table_name,
        detail: noIndexes
          ? 'No indexes detected on this table in pg_indexes.'
          : `Sequential scans (${seqScan}) significantly exceed index scans (${idxScan}).`,
        riskLevel,
        rewardLevel,
        priorityScore,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 80);
}

function buildSortHotspotCandidates(rows: SortHotspotRow[]): OptimizationCandidate[] {
  return rows
    .map((row) => {
      const sharedRead = toNumber(row.shared_blks_read);
      const tempWrites = toNumber(row.temp_blks_written);
      const calls = toNumber(row.calls);
      const score = Math.min(100, Math.floor((sharedRead + tempWrites * 3) / 100 + calls / 100));
      const riskLevel: RiskLevel = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
      const rewardLevel: RewardLevel = score >= 50 ? 'high' : 'medium';

      return {
        category: 'sort_hotspot' as const,
        schema: 'public',
        table: 'query_workload',
        detail: row.query_excerpt,
        riskLevel,
        rewardLevel,
        priorityScore: Math.max(20, score),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 40);
}

function buildFkGapCandidates(rows: MissingFkIndexRow[]): OptimizationCandidate[] {
  return rows
    .map((row) => {
      const fkColumns = parsePgTextArray(row.fk_columns);
      const detail = `Foreign key ${row.constraint_name} on (${fkColumns.join(', ') || 'unknown'}) has no supporting index prefix.`;
      return {
        category: 'foreign_key_index_gap' as const,
        schema: row.schema_name,
        table: row.table_name,
        detail,
        riskLevel: 'high' as const,
        rewardLevel: 'high' as const,
        priorityScore: 75,
      };
    })
    .slice(0, 120);
}

function toRiskRewardMatrix(candidates: OptimizationCandidate[]): RiskRewardRow[] {
  return candidates
    .slice(0, 40)
    .map((candidate) => {
      const reward =
        candidate.category === 'sort_hotspot'
          ? 'Reduces expensive ORDER BY runtime, temp spill, and dashboard latency.'
          : 'Improves lookup/select performance and reduces sequential scan pressure.';
      const risk =
        'Additional index storage and write-path overhead during INSERT/UPDATE/DELETE operations.';
      const recommendation: RiskRewardRow['recommendation'] =
        candidate.priorityScore >= 75 ? 'High priority' : candidate.priorityScore >= 50 ? 'Medium priority' : 'Low priority';

      return {
        candidate: `${candidate.schema}.${candidate.table}`,
        reward,
        risk,
        recommendation,
        priorityScore: candidate.priorityScore,
      };
    });
}

function getSupabaseRestConfig(): { baseUrl: string; serviceRoleKey: string } | null {
  const baseUrl = firstDefinedEnv(['SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
  const serviceRoleKey = firstDefinedEnv(['SUPABASE_SERVICE_ROLE_KEY']);

  if (!baseUrl || !serviceRoleKey) {
    return null;
  }

  return { baseUrl, serviceRoleKey };
}

async function querySupabaseCatalog<T>(
  config: { baseUrl: string; serviceRoleKey: string },
  endpoint: string,
): Promise<T[] | null> {
  const url = `${config.baseUrl}/rest/v1/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as T[] : null;
  } catch {
    return null;
  }
}

function normalizeRpcAuditPayload(payload: RpcAuditPayload): SchemaAuditResult | null {
  const indexCoverageCandidates = Array.isArray(payload.indexCoverageCandidates)
    ? payload.indexCoverageCandidates
    : [];
  const sortHotspots = Array.isArray(payload.sortHotspots) ? payload.sortHotspots : [];
  const riskRewardMatrix = Array.isArray(payload.riskRewardMatrix) ? payload.riskRewardMatrix : [];
  const optimizationCandidates = Array.isArray(payload.optimizationCandidates)
    ? payload.optimizationCandidates
    : [...indexCoverageCandidates, ...sortHotspots].sort((a, b) => b.priorityScore - a.priorityScore);

  if (!indexCoverageCandidates.length && !sortHotspots.length && !riskRewardMatrix.length) {
    return null;
  }

  return {
    generatedAt: payload.generatedAt || new Date().toISOString(),
    source: 'rpc_catalog',
    metadata: {
      pgStatStatementsAvailable: Boolean(payload.metadata?.pgStatStatementsAvailable),
    },
    indexCoverageCandidates,
    sortHotspots,
    riskRewardMatrix,
    optimizationCandidates,
  };
}

async function executeAuditViaSupabaseRpc(): Promise<SchemaAuditResult | null> {
  const config = getSupabaseRestConfig();
  if (!config) {
    return null;
  }

  const response = await fetch(`${config.baseUrl}/rest/v1/rpc/execute_live_schema_audit`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as RpcAuditPayload;
    return normalizeRpcAuditPayload(parsed);
  } catch {
    return null;
  }
}

async function executeAuditViaSupabaseServiceRole(): Promise<SchemaAuditResult | null> {
  const config = getSupabaseRestConfig();
  if (!config) {
    return null;
  }

  const [tableStatsRows, indexRows, sortRows] = await Promise.all([
    querySupabaseCatalog<SupabaseCatalogTableRow>(
      config,
      'pg_stat_user_tables?select=schemaname,relname,n_live_tup,seq_scan,idx_scan&schemaname=neq.pg_catalog&schemaname=neq.information_schema&limit=5000',
    ),
    querySupabaseCatalog<SupabaseCatalogTableRow>(
      config,
      'pg_indexes?select=schemaname,tablename,indexname&schemaname=neq.pg_catalog&schemaname=neq.information_schema&limit=10000',
    ),
    querySupabaseCatalog<SortHotspotRow>(
      config,
      "pg_stat_statements?select=queryid,calls,total_exec_time,mean_exec_time,rows,shared_blks_read,temp_blks_written,query:query_excerpt&query=ilike.*order%20by*&limit=100",
    ),
  ]);

  if (!tableStatsRows || !indexRows) {
    return null;
  }

  const indexCountMap = new Map<string, number>();
  for (const indexRow of indexRows) {
    const schema = String(indexRow.schemaname ?? '').trim();
    const table = String(indexRow.tablename ?? '').trim();
    if (!schema || !table) continue;
    const key = `${schema}.${table}`;
    indexCountMap.set(key, (indexCountMap.get(key) ?? 0) + 1);
  }

  const normalizedCoverage: IndexCoverageRow[] = tableStatsRows.map((row) => {
    const schema = String(row.schemaname ?? '').trim();
    const table = String(row.relname ?? '').trim();
    const key = `${schema}.${table}`;
    const indexCount = indexCountMap.get(key) ?? 0;

    return {
      schema_name: schema,
      table_name: table,
      estimated_rows: row.n_live_tup ?? 0,
      seq_scan: row.seq_scan ?? 0,
      idx_scan: row.idx_scan ?? 0,
      index_count: indexCount,
      lacks_indexes: indexCount === 0,
    };
  });

  const indexCoverageCandidates = buildIndexCoverageCandidates(normalizedCoverage);
  const sortHotspots = buildSortHotspotCandidates(sortRows ?? []);
  const optimizationCandidates = [...indexCoverageCandidates, ...sortHotspots].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );

  return {
    generatedAt: new Date().toISOString(),
    source: 'postgrest_catalog',
    metadata: {
      pgStatStatementsAvailable: Array.isArray(sortRows),
    },
    indexCoverageCandidates,
    sortHotspots,
    riskRewardMatrix: toRiskRewardMatrix(optimizationCandidates),
    optimizationCandidates,
  };
}

async function executeAuditViaDirectPg(): Promise<SchemaAuditResult> {
  const pool = new Pool({
    ...getDbConnectionConfig(),
    max: 1,
    statement_timeout: 60000,
  });

  try {
    const client = await pool.connect();
    try {
      const indexCoverageResult = await client.query<IndexCoverageRow>(INDEX_COVERAGE_SQL);
      const hasPgStatStatementsResult = await client.query<{ available: boolean }>(HAS_PG_STAT_STATEMENTS_SQL);
      const pgStatStatementsAvailable = Boolean(hasPgStatStatementsResult.rows[0]?.available);

      const sortHotspotRows: SortHotspotRow[] = pgStatStatementsAvailable
        ? (await client.query<SortHotspotRow>(SORT_HOTSPOT_SQL)).rows
        : [];

      const missingFkIndexResult = await client.query<MissingFkIndexRow>(MISSING_FK_INDEX_SQL);

      const indexCoverageCandidates = buildIndexCoverageCandidates(indexCoverageResult.rows);
      const sortHotspots = buildSortHotspotCandidates(sortHotspotRows);
      const fkGapCandidates = buildFkGapCandidates(missingFkIndexResult.rows);

      const optimizationCandidates = [
        ...indexCoverageCandidates,
        ...sortHotspots,
        ...fkGapCandidates,
      ].sort((a, b) => b.priorityScore - a.priorityScore);

      return {
        generatedAt: new Date().toISOString(),
        source: 'pg_catalog',
        metadata: {
          pgStatStatementsAvailable,
        },
        indexCoverageCandidates,
        sortHotspots,
        riskRewardMatrix: toRiskRewardMatrix(optimizationCandidates),
        optimizationCandidates,
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function executeLiveDatabaseSchemaAudit(): Promise<SchemaAuditResult> {
  const rpcResult = await executeAuditViaSupabaseRpc();
  if (rpcResult) {
    return rpcResult;
  }

  const serviceRoleResult = await executeAuditViaSupabaseServiceRole();
  if (serviceRoleResult) {
    return serviceRoleResult;
  }

  return executeAuditViaDirectPg();
}
