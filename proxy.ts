import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { LRUCache } from 'lru-cache';

// In-memory rate limiter backed by LRU cache to prevent memory leaks
const WINDOW_MS = 60 * 1000; // 1 minute
const LIMIT = 10; // 10 requests per minute
const rateLimit = new LRUCache<string, { count: number; lastReset: number }>({
    max: 5000,
    ttl: WINDOW_MS,
});

function getClientIp(request: NextRequest): string {
    const directIp = (request as { ip?: string }).ip;
    if (directIp) return directIp;
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return '127.0.0.1';
}

export function proxy(request: NextRequest) {
    const response = NextResponse.next();

    // 1. Hardened Security Headers & CSP
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = isDev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self' 'unsafe-inline'";

    response.headers.set('X-DNS-Prefetch-Control', 'on');
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'origin-when-cross-origin');
    response.headers.set(
        'Content-Security-Policy',
        `default-src 'self'; img-src 'self' data: https:; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self';`
    );

    // 2. Rate Limiting (Only for API routes)
    if (request.nextUrl.pathname.startsWith('/api/analyze')) {
        const ip = getClientIp(request);
        const now = Date.now();
        const record = rateLimit.get(ip) || { count: 0, lastReset: now };

        if (now - record.lastReset > WINDOW_MS) {
            record.count = 0;
            record.lastReset = now;
        }

        if (record.count >= LIMIT) {
            return new NextResponse(
                JSON.stringify({ error: 'Too many requests. Please try again later.' }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            );
        }

        record.count++;
        rateLimit.set(ip, record);
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
