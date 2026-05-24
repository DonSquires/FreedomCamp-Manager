const ENV_ALIAS_MAP: Record<string, string[]> = {
  SUPABASE_SERVICE_ROLE_KEY: ['SERVICE_ROLE_KEY', 'SB_SERVICE_KEY'],
  SUPABASE_URL: ['VITE_SUPABASE_URL', 'SUPABASE_PROJECT_URL'],
  SUPABASE_PROJECT_REF: ['PROJECT_REF', 'SUPABASE_REF'],
  RAILWAY_API_TOKEN: ['RAILWAY_TOKEN', 'RAILWAY_CORE_TOKEN'],
  RAILWAY_PROJECT_ID: ['RAILWAY_PROXY_PROJECT_ID', 'RAILWAY_CORE_PROJECT_ID'],
  RAILWAY_SERVICE_ID: ['RAILWAY_BACKEND_SERVICE_ID', 'RAILWAY_PROXY_SERVICE_ID'],
  OPENAI_API_KEY: ['OPENAI_KEY', 'LLM_API_KEY'],
};

export async function discoverEnvironmentKey(targetKey: string): Promise<string | null> {
  const normalizedKey = String(targetKey || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const directValue = String(process.env[normalizedKey] ?? '').trim();
  if (directValue) {
    return directValue;
  }

  const aliases = ENV_ALIAS_MAP[normalizedKey] ?? [];
  for (const alias of aliases) {
    const aliasValue = String(process.env[alias] ?? '').trim();
    if (!aliasValue) {
      continue;
    }

    if (!process.env[normalizedKey]) {
      process.env[normalizedKey] = aliasValue;
    }

    console.info(
      `[INTROSPECTION] Bob autonomously mapped missing key ${normalizedKey} to active shell fallback.`
    );
    return aliasValue;
  }

  return null;
}
