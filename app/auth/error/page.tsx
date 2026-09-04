import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertCircle className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">Sign-in could not be completed</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your calendar is still safe on this device. Return to the dashboard and try Google sign-in again.
        </p>
        <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" /> Return to dashboard
        </Link>
      </section>
    </main>
  );
}
