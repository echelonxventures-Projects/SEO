import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-5xl font-bold text-zinc-200 dark:text-zinc-800">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-zinc-500">The page you were looking for doesn&apos;t exist, was deleted, or belongs to another workspace.</p>
      <Link href="/dashboard" className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900">
        Back to dashboard
      </Link>
    </div>
  );
}
