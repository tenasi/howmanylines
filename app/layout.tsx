import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = process.env.BASE_URL || 'https://example.com';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "How Many Lines? - Git Repository Code Analysis",
    template: "%s | How Many Lines?"
  },
  description: "Instantly count lines of code in any public Git repository. Visualize code composition by language for GitHub, GitLab, and Bitbucket projects.",
  keywords: ["git", "lines of code", "loc", "analysis", "github", "gitlab", "bitbucket", "code counter", "repository statistics"],
  authors: [{ name: "Jonathan" }],
  creator: "Jonathan",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: baseUrl,
    title: "How Many Lines? - Git Repository Code Analysis",
    description: "Instantly count lines of code in any public Git repository. Visualize code composition by language.",
    siteName: "How Many Lines?",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "How Many Lines? Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "How Many Lines? - Git Repository Code Analysis",
    description: "Instantly count lines of code in any public Git repository. Visualize code composition by language.",
    creator: "@jonathan",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
