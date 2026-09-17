import { LoginForm } from '@/components/auth/LoginForm';
import Link from 'next/link';

export const metadata = {
  title: 'Sign in — Krix',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { created?: string };
}) {
  return (
    <div className="flex min-h-screen flex-col bg-black px-6 py-12 text-white">
      <Link
        href="/"
        className="mx-auto text-lg font-semibold tracking-tight text-white"
      >
        krix™
      </Link>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-white">
          Welcome back.
        </h1>
        {searchParams?.created === '1' && (
          <p className="mt-2 text-center text-sm text-green-600 bg-green-50 rounded-xl px-4 py-2 font-medium">
            Account created! Sign in below.
          </p>
        )}
        <p className="mt-2 text-center text-neutral-400">
          Sign in to continue to your workspace.
        </p>

        <div className="mt-10 rounded-3xl bg-white p-8 shadow-2xl">
          <LoginForm />
        </div>

        <p className="mt-8 text-center text-sm text-neutral-400">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="font-medium text-white hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}