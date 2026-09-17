'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/Button';
import { Plus, LayoutGrid } from '@/components/dashboard/icons';

interface Project {
  name: string;
  videos: number;
  clips: number;
  updated: string;
  status: 'progress' | 'ready' | 'archived';
}

const initialProjects: Project[] = [
  { name: 'The Creator Show — Ep 42', videos: 3, clips: 27, updated: '2 hours ago', status: 'ready' },
  { name: 'Podcast Repurposing', videos: 2, clips: 12, updated: 'Yesterday', status: 'progress' },
  { name: 'Product Demos Q3', videos: 1, clips: 8, updated: '3 days ago', status: 'ready' },
  { name: 'Church Sermons', videos: 5, clips: 34, updated: 'Last week', status: 'ready' },
];

const statusStyles: Record<Project['status'], string> = {
  progress: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  ready: 'bg-green-400/10 text-green-300 ring-green-400/30',
  archived: 'bg-white/5 text-neutral-400 ring-white/10',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState(initialProjects);
  const [newName, setNewName] = useState('');

  const count = useMemo(() => projects.length, [projects]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setProjects((prev) => [
      { name: newName.trim(), videos: 0, clips: 0, updated: 'Just now', status: 'progress' },
      ...prev,
    ]);
    setNewName('');
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="My projects"
        subtitle={`Organize your videos, clips, and publishing by project. ${count} project${count === 1 ? '' : 's'}.`}
        action={
          <Link href="/dashboard/upload">
            <Button inverse>Create new →</Button>
          </Link>
        }
      />

      <form onSubmit={handleCreate} className="mb-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">
            <Plus className="h-4 w-4" />
          </span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name your project — e.g. The Creator Show"
            className="w-full rounded-2xl border border-white/15 bg-white/[0.04] py-3 pl-10 pr-4 text-sm text-white placeholder:text-neutral-500 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Create project
        </Button>
      </form>

      {projects.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center">
          <div className="mb-3 text-4xl">🗂️</div>
          <h3 className="text-xl font-semibold text-white">No projects yet</h3>
          <p className="mt-2 text-sm text-neutral-400">Create a project above to keep your work organized.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <div
              key={project.name}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-white/25 hover:bg-white/[0.06]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white">
                    <LayoutGrid className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{project.name}</h3>
                    <p className="text-xs text-neutral-500">
                      {project.videos} videos · {project.clips} clips · updated {project.updated}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${statusStyles[project.status]}`}>
                  {project.status}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
                <Link href="/dashboard/upload" className="text-xs font-medium text-neutral-400 hover:text-white">
                  + Video
                </Link>
                <Link href="/dashboard/calendar" className="text-xs font-medium text-neutral-400 hover:text-white">
                  + Schedule
                </Link>
                <span className="ml-auto text-xs text-neutral-600">∞ credits</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}