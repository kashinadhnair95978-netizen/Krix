'use client';

import { Navbar } from '@/components/dashboard/Navbar';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ToastProvider } from '@/components/ui/Toast';
import { CommandPalette } from '@/components/dashboard/CommandPalette';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <ToastProvider>
        <div className="min-h-screen bg-black text-neutral-100">
          <Navbar />
          <div className="flex">
            <Sidebar />
            <main className="min-w-0 flex-1">
              <div className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,255,255,0.09),transparent)]" />
              <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
                {children}
              </div>
            </main>
          </div>
          <CommandPalette />
        </div>
      </ToastProvider>
    </ProtectedRoute>
  );
}