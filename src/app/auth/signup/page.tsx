import { SignupForm } from '@/components/auth/SignupForm';
import Link from 'next/link';

export const metadata = {
  title: 'Create your account — Krix',
};

export default function SignupPage() {
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
          Create your account.
        </h1>
        <p className="mt-2 text-center text-neutral-400">
          Start your free 7-day trial. No credit card required.
        </p>

        <div className="mt-10 rounded-3xl bg-white p-8 shadow-2xl">
          <SignupForm />
        </div>

        <p className="mt-8 text-center text-sm text-neutral-400">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-white hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <p className="text-center text-xs text-neutral-600">
        By signing up you agree to our Terms and Privacy Policy.
      </p>
    </div>
  );
}