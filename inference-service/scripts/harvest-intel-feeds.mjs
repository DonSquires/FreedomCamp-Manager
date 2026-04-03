import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = Number(process.env.INTEL_FETCH_TIMEOUT_MS || 15000);
const MAX_ITEMS_PER_FEED = Number(process.env.INTEL_MAX_ITEMS_PER_FEED || 5);
const MAX_SUMMARY = Number(process.env.INTEL_MAX_SUMMARY_LENGTH || 1200);
const DRY_RUN = ['1', 'true', 'yes', 'on'].includes((process.env.INTEL_DRY_RUN || 'false').toLowerCase());
const ALLOWED_HOSTS = String(process.env.INTEL_ALLOWED_HOSTS || '')
  .split(/[,\n]/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const NEIGHBOR_REGIONS = {
  nelson: ['tasman', 'marlborough', 'west_coast'],
  tasman: ['nelson', 'marlborough', 'west_coast'],
  marlborough: ['nelson', 'tasman', 'canterbury', 'wellington'],
  canterbury: ['marlborough', 'west_coast', 'otago'],
  otago: ['canterbury', 'southland'],
  southland: ['otago'],
  wellington: ['manawatu_whanganui', 'marlborough'],
  auckland: ['waikato', 'northland'],
  waikato: ['auckland', 'bay_of_plenty', 'manawatu_whanganui'],
  bay_of_plenty: ['waikato', 'gisborne', 'hawkes_bay'],
};

function parseFeedUrls(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max) : value;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function classifyType(title, summary, url) {
  const text = `${title} ${summary} ${url}`.toLowerCase();
  if (/jurisdiction|boundary|district plan|bylaw|zoning|zone change|gazette/.test(text)) return 'jurisdiction';
  if (/vulnerability|cve-|exploit|ransomware|malware|advisory|threat|security/.test(text)) return 'security';
  if (/act|regulation|legislation|privacy act|trespass act|freedom camping act|worksafe|compliance/.test(text)) return 'law';
  if (/api|integration|outage|incident|deprecation|release/.test(text)) return 'system';
  return 'other';
}

function detectPOI(summary) {
  const poi = {};
  const nameMatch = summary.match(/(?:person of interest|offender|wanted)[:\s-]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
  if (nameMatch) poi.full_name = nameMatch[1].trim();
  return poi.full_name ? poi : null;
}

function detectVOI(summary) {
  const plateMatch = summary.toUpperCase().match(/\b([A-Z]{2,3}[0-9]{2,4}|[A-Z][0-9]{2,4}[A-Z]{1,2})\b/);
  if (!plateMatch) return null;
  return { plate_number: plateMatch[1].replace(/[^A-Z0-9]/g, '') };
}

function detectRegions(text) {
  const normalized = text.toLowerCase();
  const lookup = [
    ['nelson', 'nelson'],
    ['tasman', 'tasman'],
    ['marlborough', 'marlborough'],
    ['canterbury', 'canterbury'],
    ['otago', 'otago'],
    ['southland', 'southland'],
    ['wellington', 'wellington'],
    ['auckland', 'auckland'],
    ['waikato', 'waikato'],
    ['bay of plenty', 'bay_of_plenty'],
    ['gisborne', 'gisborne'],
    ['hawkes bay', 'hawkes_bay'],
    ['manawatu', 'manawatu_whanganui'],
    ['whanganui', 'manawatu_whanganui'],
    ['northland', 'northland'],
    ['west coast', 'west_coast'],
  ];
  return lookup.filter(([phrase]) => normalized.includes(phrase)).map(([, tag]) => tag);
}

function classifyEmergencyEvent(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const isNational = /nationwide|national alert|all of new zealand|new zealand wide/.test(text);
  if (/amber alert/.test(text)) return { eventType: 'amber_alert', severity: 'critical', isNational };
  if (/active shooter|active offender|armed offender|lockdown/.test(text)) return { eventType: 'active_shooter', severity: 'critical', isNational };
  if (/national security|terror|extremism/.test(text)) return { eventType: 'national_security', severity: 'critical', isNational: true };
  if (/civil defense|evacuation|tsunami|earthquake|volcanic/.test(text)) return { eventType: 'civil_defense', severity: 'high', isNational };
  if (/severe weather|red warning|orange warning|metservice warning|flood warning|storm warning/.test(text)) return { eventType: 'severe_weather', severity: 'high', isNational };
  if (/emergency alert|emergency mobile alert/.test(text)) return { eventType: 'emergency_alert', severity: 'high', isNational };
  return null;
}

function getTargetOrgIdsFromRegions(regionTags, regionOrgMap) {
  const regions = new Set(regionTags);
  for (const tag of regionTags) {
    for (const neighbor of NEIGHBOR_REGIONS[tag] || []) {
      regions.add(neighbor);
    }
  }

  const orgIds = new Set();
  for (const tag of regions) {
    const ids = regionOrgMap[tag] || [];
    for (const id of ids) {
      if (id) orgIds.add(id);
    }
  }
  return Array.from(orgIds);
}

function extractRssItems(xml, sourceUrl) {
  const items = [];
  const blocks = String(xml).match(/<item[\s\S]*?<\/item>/gi) || String(xml).match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = decodeEntities(stripTags((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'Untitled'));
    const description = decodeEntities(stripTags((block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || ''));
    const link = decodeEntities(((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || block.match(/href=["']([^"']+)["']/i) || [])[1] || sourceUrl).trim());
    const date = decodeEntities(((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1] || '').trim());

    items.push({
      title: clip(title, 300),
      summary: clip(description, MAX_SUMMARY),
      source_url: link || sourceUrl,
      published_at: date || null,
    });
  }
  return items;
}

function extractHtmlItem(html, sourceUrl) {
  const title = decodeEntities(stripTags((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || 'Update'));
  const metaDescription = decodeEntities(stripTags((String(html).match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || ''));
  const h1 = decodeEntities(stripTags((String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || ''));
  const summary = metaDescription || h1 || title;

  return [{
    title: clip(title, 300),
    summary: clip(summary, MAX_SUMMARY),
    source_url: sourceUrl,
    published_at: null,
  }];
}

async function fetchWithTimeout(url) {
  if (ALLOWED_HOSTS.length) {
    const host = new URL(url).hostname.toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) {
      throw new Error(`Host ${host} is not in INTEL_ALLOWED_HOSTS allowlist`);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'FieldOps-Intel-Harvester/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    return { contentType, body };
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeed(contentType, body, sourceUrl) {
  const trimmed = String(body || '').trim();
  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return arr.slice(0, MAX_ITEMS_PER_FEED).map((item) => ({
      title: clip(item?.title || item?.name || 'Update', 300),
      summary: clip(item?.summary || item?.description || item?.content || 'No summary provided', MAX_SUMMARY),
      source_url: item?.url || item?.link || sourceUrl,
      published_at: item?.published_at || item?.published || item?.date || null,
    }));
  }
  if (contentType.includes('xml') || trimmed.includes('<rss') || trimmed.includes('<feed')) {
    return extractRssItems(trimmed, sourceUrl);
  }
  return extractHtmlItem(trimmed, sourceUrl);
}

async function ingestBulletin(ingestUrl, apiKey, hmacKey, bulletin) {
  if (DRY_RUN) {
    console.log(`DRY_RUN ingest -> [${bulletin.type}] ${bulletin.title}`);
    return;
  }

  const payload = JSON.stringify({ bulletin });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (hmacKey) {
    headers['x-intel-signature'] = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
  }

  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers,
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Intel ingest failed (${response.status}): ${text}`);
  }
}

async function insertSupabaseRows(supabaseUrl, serviceRoleKey, table, rows) {
  if (!rows.length) return;
  if (DRY_RUN) {
    console.log(`DRY_RUN DB insert -> table=${table} rows=${rows.length}`);
    return;
  }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase insert failed (${response.status}): ${text}`);
  }
}

function hashBulletin(b) {
  return crypto.createHash('sha256').update(`${b.title}|${b.summary}|${b.source_url}`).digest('hex');
}

async function main() {
  const feedUrls = parseFeedUrls(process.env.INTEL_FEED_URLS);
  const ingestUrl = process.env.INTEL_INGEST_URL;
  const apiKey = process.env.INFERENCE_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hmacKey = process.env.INTEL_HMAC_KEY || '';

  if (!feedUrls.length) throw new Error('INTEL_FEED_URLS is required (comma or newline separated).');
  if (!ingestUrl) throw new Error('INTEL_INGEST_URL is required.');
  if (!apiKey) throw new Error('INFERENCE_API_KEY or SUPABASE_SERVICE_ROLE_KEY is required.');

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const orgId = process.env.INTEL_ORGANIZATION_ID || '';
  const regionOrgMap = (() => {
    try {
      return JSON.parse(process.env.INTEL_REGION_ORG_MAP || '{}');
    } catch {
      return {};
    }
  })();
  const dbEnabled = ['1', 'true', 'yes', 'on'].includes((process.env.INTEL_ENABLE_DB_SYNC || 'false').toLowerCase());

  const seen = new Set();
  const supabaseIntelRows = [];
  const publicSafetyAlerts = [];
  let ingestedCount = 0;

  for (const url of feedUrls) {
    try {
      const { contentType, body } = await fetchWithTimeout(url);
      const items = parseFeed(contentType, body, url);

      for (const item of items) {
        const title = clip(item.title, 300);
        const summary = clip(item.summary, MAX_SUMMARY);
        if (!title || !summary) continue;

        const fingerprint = hashBulletin({ title, summary, source_url: item.source_url });
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        const type = classifyType(title, summary, item.source_url || url);
        const bulletin = {
          type,
          title,
          summary,
          source: item.source_url || url,
          effective_date: item.published_at || null,
          metadata: {
            feed_url: url,
            hash: fingerprint,
          },
        };

        const poi = detectPOI(summary);
        const voi = detectVOI(summary);
        if (poi) bulletin.metadata.poi_candidate = poi;
        if (voi) bulletin.metadata.voi_candidate = voi;

        await ingestBulletin(ingestUrl, apiKey, hmacKey, bulletin);
        ingestedCount += 1;

        if (dbEnabled && supabaseUrl && supabaseServiceRoleKey && orgId) {
          supabaseIntelRows.push({
            organization_id: orgId,
            type,
            title,
            summary,
            source_url: item.source_url || url,
            published_at: item.published_at || null,
            metadata: bulletin.metadata,
            approval_status: 'pending',
            poi_candidate: poi || null,
            voi_candidate: voi || null,
          });

          const event = classifyEmergencyEvent(title, summary);
          if (event) {
            const regionTags = detectRegions(`${title} ${summary}`);
            const targetOrgIds = event.isNational
              ? []
              : getTargetOrgIdsFromRegions(regionTags, regionOrgMap);

            publicSafetyAlerts.push({
              organization_id: orgId,
              event_type: event.eventType,
              severity: event.severity,
              scope: event.isNational ? 'national' : 'regional',
              status: 'pending',
              title,
              message: summary,
              target_organization_ids: targetOrgIds,
              target_region_tags: regionTags,
              starts_at: new Date().toISOString(),
              expires_at: null,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Feed harvest failed for ${url}: ${error.message}`);
    }
  }

  if (dbEnabled && supabaseUrl && supabaseServiceRoleKey && orgId) {
    if (supabaseIntelRows.length) {
      await insertSupabaseRows(supabaseUrl, supabaseServiceRoleKey, process.env.INTEL_DB_TABLE || 'external_intel_bulletins', supabaseIntelRows);
    }
    if (publicSafetyAlerts.length) {
      await insertSupabaseRows(supabaseUrl, supabaseServiceRoleKey, 'public_safety_alerts', publicSafetyAlerts);
    }
  }

  console.log(`Intel harvest complete. Bulletins ingested: ${ingestedCount}`);
  console.log(`DB sync enabled: ${dbEnabled}`);
  console.log(`Dry run mode: ${DRY_RUN}`);
  if (dbEnabled) {
    console.log(`external_intel_bulletins rows: ${supabaseIntelRows.length}`);
    console.log(`public_safety_alerts rows: ${publicSafetyAlerts.length}`);
  }
}

main().catch((error) => {
  console.error('harvest-intel-feeds failed:', error.message);
  process.exit(1);
});
