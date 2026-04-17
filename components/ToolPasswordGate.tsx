"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
  toolTitle: string;
};

type SessionPayload = {
  unlocked: boolean;
  passwordConfigured: boolean;
};

export function ToolPasswordGate({ children, toolTitle }: Props) {
  const [phase, setPhase] = useState<"loading" | "locked" | "unlocked">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/tools/session", { credentials: "include" });
      const data = (await res.json()) as Partial<SessionPayload>;
      if (data.passwordConfigured === false) {
        setError("This tool is not available: the server has no PASSWORD configured.");
        setPhase("locked");
        return;
      }
      if (data.unlocked) {
        setPhase("unlocked");
      } else {
        setPhase("locked");
      }
    } catch {
      setError("Could not verify access. Check your connection and try again.");
      setPhase("locked");
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      try {
        const res = await fetch("/api/tools/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ password }),
        });
        const payload = (await res.json().catch(() => null)) as { error?: string };
        if (!res.ok) {
          setError(payload?.error || "Incorrect password.");
          return;
        }
        setPassword("");
        setPhase("unlocked");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("rmk-tools-session"));
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    },
    [password],
  );

  if (phase === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-16">
        <div className="flex items-center gap-3 text-sm text-[color:var(--muted)]">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]"
            aria-hidden
          />
          Checking access…
        </div>
      </div>
    );
  }

  if (phase === "unlocked") {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-8 shadow-lg shadow-black/20">
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
        Password required
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">{toolTitle}</h2>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Enter the access password to use this tool. It is stored on the server only.
      </p>

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="tool-password" className="sr-only">
            Password
          </label>
          <input
            id="tool-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-4 py-3 text-sm text-[color:var(--text)] outline-none ring-0 transition placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)]"
            required
          />
        </div>
        {error ? (
          <p
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-[color:var(--danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-xl bg-[color:var(--accent)] py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-hover)]"
        >
          Unlock tool
        </button>
      </form>
    </div>
  );
}
