import Link from 'next/link';

const columns = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#capabilities' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Solutions', href: '#solutions' },
      { label: 'Workflow', href: '#workflow' },
      { label: "What's new", href: '#' },
      { label: 'Release notes', href: '#' },
    ],
  },
  {
    heading: 'Tools',
    links: [
      { label: 'ClipAnything', href: '#capabilities' },
      { label: 'AI B-Roll', href: '#capabilities' },
      { label: 'Social scheduler', href: '#capabilities' },
      { label: 'Thumbnail generator', href: '#capabilities' },
      { label: 'Export to XML', href: '#capabilities' },
      { label: 'Brand templates', href: '#capabilities' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Help', href: '#' },
      { label: 'Podcast repurposing', href: '#' },
      { label: 'Creators', href: '#testimonials' },
      { label: 'Inspiration gallery', href: '#' },
      { label: 'Blog', href: '#' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Careers', href: '#' },
      { label: 'Press', href: '#' },
      { label: 'Legal', href: '#' },
    ],
  },
  {
    heading: 'Developers',
    links: [
      { label: 'API', href: '#' },
      { label: 'Video MCP', href: '#' },
      { label: 'Documentation', href: '#' },
      { label: 'Status', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-[#0d0d0f] pb-10 pt-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-8 border-b border-white/10 pb-10 md:grid-cols-4 lg:grid-cols-5">
          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="text-sm font-semibold text-white">
                {column.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs text-neutral-500 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-4 text-xs text-neutral-600 md:flex-row">
          <p>
            Copyright © {new Date().getFullYear()} Krix Inc. All rights
            reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="transition-colors hover:text-white">
              Privacy Policy
            </a>
            <a href="#" className="transition-colors hover:text-white">
              Terms of Use
            </a>
            <a href="#" className="transition-colors hover:text-white">
              Legal
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}