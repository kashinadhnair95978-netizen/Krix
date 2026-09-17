import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Krix — Turn 1 Video Into 100 Posts',
    template: '%s — Krix',
  },
  description:
    'AI-powered content repurposing. Turn one video into shorts, tweets, blogs, emails, and LinkedIn posts — with auto-captions, hooks, and platform-perfect formatting.',
  keywords:
    'content repurposing, AI content, video to blog, video repurposing, content automation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}