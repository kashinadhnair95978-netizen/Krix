'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSubscription } from '@/lib/hooks';
import {
  Home,
  Upload,
  Video,
  CalendarIcon,
  LayoutGrid,
  Terminal,
  Users,
  Settings2,
  Folder,
} from './icons';

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const groups: NavGroup[] = [
  {
    label: 'Create',
    links: [
      { href: '/dashboard', label: 'Center', icon: <Home className="h-[18px] w-[18px]" /> },
      { href: '/dashboard/upload', label: 'Create new', icon: <Upload className="h-[18px] w-[18px]" /> },
    ],
  },
  {
    label: 'Manage',
    links: [
      { href: '/dashboard/projects', label: 'My projects', icon: <Folder className="h-[18px] w-[18px]" /> },
      { href: '/dashboard/videos', label: 'My clips', icon: <Video className="h-[18px] w-[18px]" /> },
    ],
  },
  {
    label: 'Grow',
    links: [
      { href: '/dashboard/calendar', label: 'Calendar', icon: <CalendarIcon className="h-[18px] w-[18px]" /> },
      { href: '/dashboard/analytics', label: 'Analytics', icon: <SparkleIcon className="h-[18px] w-[18px]" /> },
      { href: '/dashboard/inspiration', label: 'Inspiration', icon: <LayoutGrid className="h-[18px] w-[18px]" /> },
    ],
  },
  {
    label: 'Develop',
    links: [
      { href: '/dashboard/api', label: 'API & MCP', icon: <Terminal className="h-[18px] w-[18px]" /> },
      { href: '/dashboard/team', label: 'Team', icon: <Users className="h-[18px] w-[18px]" /> },
    ],
  },
  {
    label: 'Account',
    links: [
      { href: '/dashboard/settings', label: 'Settings', icon: <Settings2 className="h-[18px] w-[18px]" /> },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { subscription } = useSubscription();

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/10 bg-black">
      <div className="flex-1 overflow-y-auto p-4">
        <nav className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-600">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.links.map((link) => {
                  const active = isActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? 'bg-white text-black font-semibold'
                          : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className={active ? 'text-black' : 'text-neutral-500'}>
                        {link.icon}
                      </span>
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="border-gradient relative rounded-2xl p-4 shadow-[0_0_40px_-12px_rgba(255,255,255,0.25)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">
              {subscription?.status === 'active'
                ? `${subscription.plan} plan`
                : 'Free trial'}
            </p>
            <span
              className={`h-2 w-2 rounded-full ${
                subscription?.status === 'active'
                  ? 'bg-green-400'
                  : 'bg-amber-400'
              }`}
            />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {subscription?.status === 'active'
              ? 'Unlimited repurposing'
              : `${
                  subscription?.plan ? subscription.plan : 'Starter'
                } · 90 credits free`}
          </p>
          <Link
            href="/pricing"
            className="mt-3 block rounded-full bg-white py-1.5 text-center text-xs font-medium text-black transition-colors hover:bg-neutral-200"
          >
            {subscription?.status === 'active' ? 'Manage plan' : 'Get free clips →'}
          </Link>
        </div>
      </div>
    </aside>
  );
}

function SparkleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}