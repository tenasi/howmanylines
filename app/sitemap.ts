import { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = process.env.BASE_URL || 'https://example.com';
    return [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 1,
        },
    ];
}
