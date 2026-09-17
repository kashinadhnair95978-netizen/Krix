'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/Button';
import { Users, Plus } from '@/components/dashboard/icons';

interface Member {
  name: string;
  email: string;
  role: 'Owner' | 'Editor' | 'Viewer';
  status: 'active' | 'invited';
}

const initialMembers: Member[] = [
  { name: 'Priya Nair', email: 'priya@krix.app', role: 'Owner', status: 'active' },
  { name: 'Alex Kim', email: 'alex@krix.app', role: 'Editor', status: 'active' },
  { name: 'Sam Rivera', email: 'sam@krix.app', role: 'Viewer', status: 'active' },
  { name: 'Jamie Chen', email: 'jamie@krix.app', role: 'Editor', status: 'invited' },
];

const roleStyles: Record<Member['role'], string> = {
  Owner: 'bg-white text-black',
  Editor: 'bg-white/10 text-white',
  Viewer: 'bg-white/5 text-neutral-400',
};

export default function TeamPage() {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('Editor');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const name = email.split('@')[0].replace(/[._-]/g, ' ');
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    setMembers((prev) => [
      { name: pretty, email: email.trim(), role, status: 'invited' },
      ...prev,
    ]);
    setEmail('');
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Team workspace"
        subtitle="Work together on clips, projects, and publishing — with roles and shared credits."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-neutral-300">
            <Users className="h-3.5 w-3.5" /> {members.length} members
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="font-semibold text-white">Members</h2>
            <p className="text-sm text-neutral-500">Invite teammates and manage their access.</p>

            <ul className="mt-5 divide-y divide-white/10">
              {members.map((member) => (
                <li key={member.email} className="flex items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-900 text-xs font-semibold text-white ring-1 ring-white/15">
                      {member.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{member.name}</p>
                      <p className="text-xs text-neutral-500">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.status === 'invited' && (
                      <span className="rounded-full bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                        Invited
                      </span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${roleStyles[member.role]}`}>
                      {member.role}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <form onSubmit={handleInvite} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <Plus className="h-4 w-4" /> Invite a teammate
            </h3>
            <p className="mt-1 text-xs text-neutral-500">They’ll get an email with a workspace link.</p>
            <div className="mt-4 space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-neutral-600 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Member['role'])}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-white/40 focus:outline-none"
              >
                <option>Editor</option>
                <option>Viewer</option>
                <option>Owner</option>
              </select>
              <Button type="submit" inverse className="w-full">
                Send invite
              </Button>
            </div>
          </form>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h3 className="font-semibold text-white">Shared workspace</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-neutral-400">
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> Shared clip library
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> Team brand templates
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> Central credit pool
              </li>
            </ul>
            <Button variant="outline" inverse className="mt-4 w-full">
              Upgrade for 5 seats →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}