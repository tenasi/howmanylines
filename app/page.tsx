import LandingPage from '@/components/LandingPage';

export default function Home() {
  const baseUrl = process.env.BASE_URL || 'https://example.com';

  return <LandingPage baseUrl={baseUrl} />;
}
