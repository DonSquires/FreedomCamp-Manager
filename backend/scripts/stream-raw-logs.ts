#!/usr/bin/env node

const PRIMARY_ENDPOINT = 'https://railway.app/graphql/v2';
const FALLBACK_ENDPOINT = 'https://backboard.railway.app/graphql/v2';

const PROJECT_ID = String(process.env.RAILWAY_PROXY_PROJECT_ID || 'c5305775-ecf5-4d67-a59f-b7ae49838561').trim();
const ENVIRONMENT_ID = 'dd4cf850-e604-458c-869d-da4ad54279db';
const SERVICE_NAME = 'fieldops-backend';
const SERVICE_ID = String(
  process.env.RAILWAY_BACKEND_SERVICE_ID || process.env.RAILWAY_PROXY_SERVICE_ID || '44e08d1a-c626-400c-b78c-c64eec259768'
).trim();
const RAILWAY_CORE_TOKEN = String(
  process.env.RAILWAY_TOKEN ||
    process.env.RAILWAY_CORE_TOKEN ||
    process.env.RAILWAY_API_TOKEN ||
    process.env.RAILWAY_STT_TOKEN ||
    ''
).trim();

const POLL_INTERVAL_MS = Number.parseInt(String(process.env.RAILWAY_LOG_POLL_MS || '3000'), 10);
const BATCH_LIMIT = Number.parseInt(String(process.env.RAILWAY_LOG_LIMIT || '150'), 10);

type GraphqlResponse = {
  data?: {
    environmentLogs?: Array<{
      timestamp?: string;
      severity?: string;
      message?: string;
      tags?: {
        projectId?: string;
        environmentId?: string;
        serviceId?: string;
      };
    }>;
  };
  errors?: Array<{ message?: string }>;
};

const ENVIRONMENT_LOGS_QUERY = `
  query StreamEnvironmentLogs(
    $environmentId: String!
    $afterDate: String
    $afterLimit: Int!
    $filter: String
  ) {
    environmentLogs(
      environmentId: $environmentId
      afterDate: $afterDate
      afterLimit: $afterLimit
      filter: $filter
    ) {
      timestamp
      severity
      message
      tags {
        projectId
        environmentId
        serviceId
      }
    }
  }
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asIsoString(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

async function postGraphql(endpoint: string, afterDate: string | null): Promise<GraphqlResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RAILWAY_CORE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: ENVIRONMENT_LOGS_QUERY,
      variables: {
        environmentId: ENVIRONMENT_ID,
        afterDate,
        afterLimit: BATCH_LIMIT,
        filter: `${SERVICE_NAME} ${SERVICE_ID} ${PROJECT_ID}`.trim(),
      },
    }),
  });

  const text = await response.text();

  try {
    return text ? (JSON.parse(text) as GraphqlResponse) : {};
  } catch {
    return {
      errors: [{ message: `Non-JSON response (${response.status}): ${text.slice(0, 280)}` }],
    };
  }
}

async function readEnvironmentLogs(afterDate: string | null): Promise<Array<{ timestamp: string; severity: string; message: string }>> {
  const primary = await postGraphql(PRIMARY_ENDPOINT, afterDate);
  const primaryErrors = primary.errors?.map((error) => error?.message || 'Unknown error').join(' | ') || '';

  const payload = primaryErrors.includes('Non-JSON response (404)')
    ? await postGraphql(FALLBACK_ENDPOINT, afterDate)
    : primary;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error?.message || 'Unknown error').join(' | '));
  }

  const logs = Array.isArray(payload.data?.environmentLogs) ? payload.data?.environmentLogs : [];

  return logs
    .filter((log) => {
      const tags = log.tags || {};
      const matchProject = !tags.projectId || String(tags.projectId) === PROJECT_ID;
      const matchEnvironment = !tags.environmentId || String(tags.environmentId) === ENVIRONMENT_ID;
      const matchService = !SERVICE_ID || !tags.serviceId || String(tags.serviceId) === SERVICE_ID;
      return matchProject && matchEnvironment && matchService;
    })
    .map((log) => ({
      timestamp: String(log.timestamp || new Date().toISOString()),
      severity: String(log.severity || 'INFO').toUpperCase(),
      message: String(log.message || '').trim(),
    }))
    .filter((log) => Boolean(log.message));
}

async function main(): Promise<void> {
  if (!RAILWAY_CORE_TOKEN) {
    throw new Error('Missing RAILWAY_CORE_TOKEN in environment.');
  }

  console.log('[stream-raw-logs] starting GraphQL log stream');
  console.log(
    `[stream-raw-logs] project=${PROJECT_ID} environment=${ENVIRONMENT_ID} service=${SERVICE_NAME} serviceId=${SERVICE_ID}`
  );

  const seen = new Set<string>();
  let lastSeenDate: string | null = null;

  while (true) {
    try {
      const logs = await readEnvironmentLogs(lastSeenDate);

      for (const log of logs) {
        const fingerprint = `${log.timestamp}|${log.severity}|${log.message}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        if (seen.size > 5000) {
          const first = seen.values().next().value;
          if (first) seen.delete(first);
        }

        console.log(`${log.timestamp} [${log.severity}] ${log.message}`);

        const normalized = asIsoString(log.timestamp);
        if (normalized && (!lastSeenDate || normalized > lastSeenDate)) {
          lastSeenDate = normalized;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[stream-raw-logs] poll error: ${message}`);
    }

    await sleep(Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS > 0 ? POLL_INTERVAL_MS : 3000);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[stream-raw-logs] fatal: ${message}`);
  process.exit(1);
});
