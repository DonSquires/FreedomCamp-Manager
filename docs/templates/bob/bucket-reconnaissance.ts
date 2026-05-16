/**
 * EXAMPLE / TEMPLATE — Metadata-Only Chunked Bucket Reconnaissance
 *
 * This file is a reference template, not production code.
 * Copy and adapt as needed.
 *
 * Follows: docs/BOB_SAFE_RUNTIME_CONTRACT.md
 *   Rule 1: Never download a complete folder payload at once.
 *   Rule 2: Maximum 50 items per pass.
 *   Rule 3: Extract metadata before reading file contents.
 *   Rule 4: Files > 5 MB are flagged for stream parsing.
 */

import { supabase } from '@/lib/supabase'

const CHUNK_SIZE = 50
const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024 // 5 MB

export interface BucketFileMetadata {
  name: string
  size: number
  contentType: string | null
  createdAt: string | null
  largFileFlag: boolean
}

export interface ReconPage {
  page: number
  offset: number
  files: BucketFileMetadata[]
  largeFiles: BucketFileMetadata[]
}

/**
 * Performs a single metadata-only page traversal of a Supabase storage bucket.
 * Returns metadata for up to CHUNK_SIZE files starting at the given offset.
 *
 * Does NOT read file contents. Callers must obtain human approval before
 * proceeding to content access for flagged large files.
 *
 * @param bucket  - Name of the Supabase storage bucket
 * @param prefix  - Folder prefix to scope the list (e.g. 'org-uuid/evidence/')
 * @param page    - Zero-based page index
 */
export async function reconPage(
  bucket: string,
  prefix: string,
  page: number,
): Promise<ReconPage> {
  const offset = page * CHUNK_SIZE

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, {
      limit: CHUNK_SIZE,
      offset,
      sortBy: { column: 'created_at', order: 'asc' },
    })

  if (error) {
    throw new Error(`Bucket recon failed (bucket=${bucket}, page=${page}): ${error.message}`)
  }

  const files: BucketFileMetadata[] = (data ?? []).map((f) => ({
    name: f.name,
    size: f.metadata?.size ?? 0,
    contentType: f.metadata?.mimetype ?? null,
    createdAt: f.created_at ?? null,
    largFileFlag: (f.metadata?.size ?? 0) > LARGE_FILE_THRESHOLD_BYTES,
  }))

  return {
    page,
    offset,
    files,
    largeFiles: files.filter((f) => f.largFileFlag),
  }
}

/**
 * Iterates through all pages of a bucket prefix, collecting metadata only.
 * After each page, yields the result so the caller can inspect and pause
 * before requesting the next page.
 *
 * Usage (human-in-the-loop):
 *   for await (const page of reconAllPages(bucket, prefix)) {
 *     console.log('Page metadata:', page)
 *     // Present to human and await approval before continuing
 *   }
 */
export async function* reconAllPages(
  bucket: string,
  prefix: string,
): AsyncGenerator<ReconPage> {
  let page = 0

  while (true) {
    const result = await reconPage(bucket, prefix, page)

    yield result

    // Stop if fewer items were returned than the chunk size (last page)
    if (result.files.length < CHUNK_SIZE) {
      break
    }

    page++
  }
}

/**
 * Example usage (do not call directly in production without human approval gate):
 *
 * const bucket = 'evidence-documents'
 * const prefix = `${organizationId}/`
 *
 * for await (const page of reconAllPages(bucket, prefix)) {
 *   console.log(`Page ${page.page}: ${page.files.length} files`)
 *   if (page.largeFiles.length > 0) {
 *     console.warn('Large files flagged for stream parsing:', page.largeFiles.map(f => f.name))
 *   }
 *   // PAUSE HERE — present summary to human and await approval before next page
 * }
 */
