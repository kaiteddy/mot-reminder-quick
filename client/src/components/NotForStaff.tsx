import { Lock } from "lucide-react";
import { Link } from "wouter";

/**
 * What a staff login sees if it lands on an owner-only page — by typing the URL, or following an
 * old bookmark or a link someone sent them. Says plainly that the page exists and isn't theirs,
 * rather than a 404 that reads like the app is broken.
 */
export function NotForStaff() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
          <Lock className="w-5 h-5 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">Not part of the workshop view</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          This page is only available on the owner's login. Nothing is wrong — you're signed in
          correctly.
        </p>
        <Link href="/">
          <span className="mt-4 inline-block text-sm font-medium text-violet-700 hover:underline cursor-pointer">
            Back to Live Jobs
          </span>
        </Link>
      </div>
    </div>
  );
}
