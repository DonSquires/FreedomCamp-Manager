import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { discoverEnvironmentKey } from './intelTools.js';

type StorageAuditAnomaly = {
  bucket: string;
  path: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  details: string;
};

type BucketAuditSummary = {
  bucket: string;
  isPublic: boolean;
  objectCount: number;
  totalBytes: number;
  anomalousObjectCount: number;
};

type ListedObject = {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
};

const MAX_LIST_DEPTH = 6;
const LARGE_IMAGE_BYTES = 5 * 1024 * 1024;

function isImagePath(path: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|bmp|tif|tiff|svg)$/i.test(path);
}

function toObjectSize(metadata: Record<string, unknown> | null | undefined): number {
  const candidate = metadata?.size;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === 'string') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

async function createAdminSupabaseClient() {
  const supabaseUrl =
    (await discoverEnvironmentKey('SUPABASE_URL')) ??
    (await discoverEnvironmentKey('VITE_SUPABASE_URL')) ??
    (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);

  const serviceRoleKey =
    (await discoverEnvironmentKey('SUPABASE_SERVICE_ROLE_KEY')) ??
    (await discoverEnvironmentKey('SERVICE_ROLE_KEY')) ??
    null;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials for storage audit.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    realtime: {
      transport: ws as unknown as never,
    },
  });
}

async function listBucketObjectsRecursive(args: {
  supabase: any;
  bucketName: string;
  prefix: string;
  depth: number;
}): Promise<string[]> {
  const { supabase, bucketName, prefix, depth } = args;

  if (depth > MAX_LIST_DEPTH) {
    return [];
  }

  const { data, error } = await supabase.storage.from(bucketName).list(prefix, {
    limit: 200,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    return [];
  }

  const entries = (Array.isArray(data) ? data : []) as ListedObject[];
  const files: string[] = [];

  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim();
    if (!name) {
      continue;
    }

    const childPath = prefix ? `${prefix}/${name}` : name;

    if (!entry?.id) {
      const nested = await listBucketObjectsRecursive({
        supabase,
        bucketName,
        prefix: childPath,
        depth: depth + 1,
      });
      files.push(...nested);
      continue;
    }

    files.push(childPath);
  }

  return files;
}

export async function auditSupabaseStorageBuckets(): Promise<any> {
  const supabase = await createAdminSupabaseClient();
  const anomalies: StorageAuditAnomaly[] = [];
  const bucketSummaries: BucketAuditSummary[] = [];

  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    throw new Error(`Failed to list storage buckets: ${String(bucketError.message || bucketError)}`);
  }

  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const bucketName = String((bucket as any)?.name ?? '').trim();
    if (!bucketName) {
      continue;
    }

    const objectPaths = await listBucketObjectsRecursive({
      supabase,
      bucketName,
      prefix: '',
      depth: 0,
    });

    let totalBytes = 0;
    let anomalousObjectCount = 0;

    for (const objectPath of objectPaths) {
      const { data: objectData, error: objectError } = await supabase.storage
        .from(bucketName)
        .list(pathDirname(objectPath), {
          limit: 200,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (objectError) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'metadata_lookup_failed',
          severity: 'medium',
          details: String(objectError.message || objectError),
        });
        anomalousObjectCount += 1;
        continue;
      }

      const entries = Array.isArray(objectData) ? objectData : [];
      const basename = objectPath.split('/').pop() ?? objectPath;
      const entry = entries.find((candidate: any) => String(candidate?.name ?? '') === basename) as ListedObject | undefined;
      const metadata = entry?.metadata ?? null;
      const size = toObjectSize(metadata);
      totalBytes += size;

      const mimeType = String((metadata as any)?.mimetype ?? (metadata as any)?.contentType ?? '').trim();
      const normalizedPath = objectPath.toLowerCase();

      if (!metadata || Object.keys(metadata).length === 0) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'missing_metadata',
          severity: 'medium',
          details: 'File metadata is empty; UI render hints may be unavailable.',
        });
        anomalousObjectCount += 1;
      }

      if (isImagePath(objectPath) && !mimeType) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'missing_mime_type',
          severity: 'high',
          details: 'Image object is missing mime type and may fail browser rendering policies.',
        });
        anomalousObjectCount += 1;
      }

      if (isImagePath(objectPath) && size === 0) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'zero_byte_image',
          severity: 'high',
          details: 'Image object has 0 bytes and is likely broken/orphaned.',
        });
        anomalousObjectCount += 1;
      }

      if (isImagePath(objectPath) && size >= LARGE_IMAGE_BYTES) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'oversized_image_asset',
          severity: 'medium',
          details: `Image exceeds ${LARGE_IMAGE_BYTES} bytes and may degrade UX page performance.`,
        });
        anomalousObjectCount += 1;
      }

      if (/\/tmp\/|\/orphan|\/unlinked|_backup|_old\./i.test(normalizedPath)) {
        anomalies.push({
          bucket: bucketName,
          path: objectPath,
          issue: 'possible_orphaned_path',
          severity: 'low',
          details: 'Path naming indicates possible orphaned or legacy binary residue.',
        });
        anomalousObjectCount += 1;
      }
    }

    bucketSummaries.push({
      bucket: bucketName,
      isPublic: Boolean((bucket as any)?.public),
      objectCount: objectPaths.length,
      totalBytes,
      anomalousObjectCount,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalBuckets: bucketSummaries.length,
    bucketSummaries,
    anomalies,
  };
}

function pathDirname(inputPath: string): string {
  const normalized = String(inputPath || '').trim();
  if (!normalized.includes('/')) {
    return '';
  }
  return normalized.slice(0, normalized.lastIndexOf('/'));
}