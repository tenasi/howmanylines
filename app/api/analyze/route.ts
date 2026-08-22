import { NextResponse } from 'next/server';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import fs from 'fs-extra';
import fsNode from 'fs';
import readline from 'readline';
import path from 'path';
import os from 'os';
import { cache } from '@/lib/cache';
import { EXTENSION_MAP } from '@/lib/constants';
import { pLimit } from '@/lib/utils';

// Security Constants
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS
  ? process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim().toLowerCase())
  : ['github.com', 'gitlab.com', 'bitbucket.org'];

const MAX_FILE_SIZE_BYTES = process.env.MAX_FILE_SIZE_BYTES
  ? parseInt(process.env.MAX_FILE_SIZE_BYTES, 10)
  : 5 * 1024 * 1024; // 5 MB default

const CACHE_TTL_MIN_SECONDS = process.env.CACHE_TTL_MIN_SECONDS
  ? parseInt(process.env.CACHE_TTL_MIN_SECONDS, 10)
  : 86400; // 1 day

const CACHE_TTL_PER_BYTE = process.env.CACHE_TTL_PER_BYTE
  ? parseFloat(process.env.CACHE_TTL_PER_BYTE)
  : 0.01; // 10 second per 1000 bytes

const ANALYSIS_TIMEOUT_SECONDS = process.env.ANALYSIS_TIMEOUT_SECONDS
  ? parseInt(process.env.ANALYSIS_TIMEOUT_SECONDS, 10)
  : 60; // 1 minute

const CACHE_TTL_ON_TIMEOUT = process.env.CACHE_TTL_ON_TIMEOUT
  ? parseInt(process.env.CACHE_TTL_ON_TIMEOUT, 10)
  : 60; // 1 minute (reduced from 1 year to prevent DoS)

// Helper to count lines streamingly without buffering large arrays in memory
function countLinesStream(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let lines = 0;
    const stream = fsNode.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on('line', () => {
      lines++;
    });

    rl.on('close', () => {
      resolve(lines);
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

export async function POST(request: Request) {
  console.log('Received POST request to /api/analyze');
  let tempDir = '';
  let canonicalUrl: string | undefined;
  const controller = new AbortController();
  const { signal } = controller;

  // Set analysis timeout
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, ANALYSIS_TIMEOUT_SECONDS * 1000);

  try {
    let body: { repoUrl?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request payload' }, { status: 400 });
    }

    const rawRepoUrl = body?.repoUrl?.trim();
    if (!rawRepoUrl) {
      return NextResponse.json({ error: 'Repository URL is required' }, { status: 400 });
    }

    // 1. Strict URL Validation & Sanitization (SSRF / Port Injection Protection)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawRepoUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format provided' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json({
        error: 'Invalid protocol. Only secure HTTPS repositories are supported.'
      }, { status: 400 });
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!ALLOWED_DOMAINS.includes(hostname)) {
      return NextResponse.json({
        error: `Domain not allowed. Supported providers: ${ALLOWED_DOMAINS.join(', ')}`
      }, { status: 400 });
    }

    if (parsedUrl.port && parsedUrl.port !== '443') {
      return NextResponse.json({
        error: 'Non-standard ports are not allowed.'
      }, { status: 400 });
    }

    // Build canonicalized URL (strips user auth, queries, hashes, trailing slashes, and .git suffix)
    const normalizedPath = parsedUrl.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
    if (!normalizedPath || normalizedPath === '/') {
      return NextResponse.json({ error: 'Please provide a valid repository path.' }, { status: 400 });
    }

    canonicalUrl = `https://${hostname}${normalizedPath}`;

    // 2. Check Cache with Canonical Key
    const cacheKey = `repo:${canonicalUrl}`;
    const cachedData = await cache.get(cacheKey);
    if (cachedData) {
      console.log(`Cache hit for ${canonicalUrl}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((cachedData as any).error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ error: (cachedData as any).error }, { status: 400 });
      }
      return NextResponse.json(cachedData);
    }

    // Create a temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'howmanylines-'));

    // Clone the repository
    console.log(`Cloning ${canonicalUrl} to ${tempDir}...`);

    // Helper to wrap fs promises with retry on EMFILE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapGraceful = (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return async (...args: any[]) => {
        if (signal.aborted) {
          throw new Error('AbortError');
        }
        let retries = 10;
        let delay = 100;
        while (true) {
          try {
            return await fn(...args);
          } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if ((error.code === 'EMFILE' || error.code === 'ENFILE') && retries > 0) {
              retries--;
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2;
              continue;
            }
            throw error;
          }
        }
      };
    };

    const gracefulPromises = Object.fromEntries(
      Object.entries(fs.promises).map(([key, value]) => [
        key,
        typeof value === 'function' ? wrapGraceful(value) : value
      ])
    );

    const customFs = {
      ...fs,
      symlink: async (_target: string, _path: string) => { // eslint-disable-line @typescript-eslint/no-unused-vars
        // Mock symlink creation to avoid EPERM on Windows
        return;
      },
      promises: {
        ...gracefulPromises,
        symlink: async (_target: string, _path: string) => { // eslint-disable-line @typescript-eslint/no-unused-vars
          return;
        },
      }
    };

    try {
      await git.clone({
        fs: customFs,
        http,
        dir: tempDir,
        url: canonicalUrl,
        singleBranch: true,
        depth: 1,
      });
    } catch (cloneErr: unknown) {
      const cloneMsg = cloneErr instanceof Error ? cloneErr.message : 'Unknown clone error';
      console.warn(`Git clone failed for ${canonicalUrl}:`, cloneMsg);
      return NextResponse.json({
        error: `Could not analyze repository. Please ensure the repository is public and accessible on ${hostname}.`
      }, { status: 400 });
    }

    // Count lines
    const stats: Record<string, number> = {};
    let totalLines = 0;
    const limit = pLimit(50); // Limit concurrency to avoid EMFILE/OOM

    async function traverse(currentPath: string) {
      if (signal.aborted) {
        throw new Error('AbortError');
      }

      const files = await fs.readdir(currentPath);

      const tasks = files.map(async (file) => {
        if (file === '.git') return;

        const filePath = path.join(currentPath, file);
        const stat = await limit(() => fs.stat(filePath));

        if (stat.isDirectory()) {
          await traverse(filePath);
        } else if (stat.isFile()) {
          // 3. Resource Limits (DoS Protection) - Max file size check
          if (stat.size > MAX_FILE_SIZE_BYTES) {
            console.warn(`Skipping large file (${stat.size} bytes > ${MAX_FILE_SIZE_BYTES} bytes): ${filePath}`);
            return;
          }

          const ext = path.extname(file).toLowerCase();
          let languageName = '';

          if (file === 'Dockerfile') {
            languageName = 'Dockerfile';
          } else if (EXTENSION_MAP[ext]) {
            languageName = EXTENSION_MAP[ext].name;
          } else {
            return;
          }

          await limit(async () => {
            try {
              const lines = await countLinesStream(filePath);

              stats[languageName] = (stats[languageName] || 0) + lines;
              totalLines += lines;
            } catch (error) {
              console.warn(`Skipping unreadable file ${filePath}:`, error);
            }
          });
        }
      });

      await Promise.all(tasks);
    }

    await traverse(tempDir);

    const result = { stats, totalLines };

    // Helper to calculate directory size
    async function getDirectorySize(dir: string): Promise<number> {
      const files = await fs.readdir(dir);
      const fileStats = files.map(async (file) => {
        const filePath = path.join(dir, file);
        const stat = await limit(() => fs.stat(filePath));
        if (stat.isDirectory()) return getDirectorySize(filePath);
        return stat.size;
      });
      return (await Promise.all(fileStats)).reduce((acc, size) => acc + size, 0);
    }

    // 4. Save to Cache with Variable TTL
    const repoSize = await getDirectorySize(tempDir);
    const ttl = Math.max(
      CACHE_TTL_MIN_SECONDS,
      Math.ceil(repoSize * CACHE_TTL_PER_BYTE)
    );
    console.log(`Caching ${canonicalUrl} for ${ttl} seconds (size: ${repoSize} bytes)`);
    await cache.set(cacheKey, result, ttl);

    return NextResponse.json(result);

  } catch (error: unknown) {
    // Handle AbortError (Timeout) specifically
    if ((error instanceof Error && error.name === 'AbortError') || (error instanceof Error && error.message === 'AbortError')) {
      const errorMessage = `Analysis timed out after ${ANALYSIS_TIMEOUT_SECONDS} seconds`;
      console.warn(`Analysis timed out for ${canonicalUrl || 'repository'}. Caching error for ${CACHE_TTL_ON_TIMEOUT} seconds.`);

      try {
        if (canonicalUrl) {
          const cacheKey = `repo:${canonicalUrl}`;
          await cache.set(cacheKey, { error: errorMessage }, CACHE_TTL_ON_TIMEOUT);
        }
      } catch (e) {
        console.error('Failed to cache error state:', e);
      }

      return NextResponse.json({ error: errorMessage }, { status: 408 });
    }

    console.error('Error processing repository:', error);

    const errorMessage = error instanceof Error ? error.message : 'Failed to process repository';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    // Cleanup temporary directory
    if (tempDir) {
      try {
        await fs.remove(tempDir);
      } catch (cleanupError) {
        console.error('Failed to cleanup temp dir:', cleanupError);
      }
    }
  }
}
