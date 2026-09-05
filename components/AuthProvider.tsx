"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthStatus = "loading" | "signed_out" | "signed_in";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      const savedUser = sessionData.session?.user ?? null;
      setUser(savedUser);
      setStatus(savedUser ? "signed_in" : "signed_out");

      if (!savedUser) {
        if (sessionError && sessionError.name !== "AuthSessionMissingError") {
          setError("We could not restore your sign-in. Please try again.");
        }
        return;
      }

      const { data: verifiedData, error: verificationError } = await supabase.auth.getUser();
      if (!active) return;
      if (verifiedData.user) {
        setUser(verifiedData.user);
        setStatus("signed_in");
        setError(null);
      } else if (verificationError?.name === "AuthSessionMissingError") {
        setUser(null);
        setStatus("signed_out");
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setStatus(session?.user ? "signed_in" : "signed_out");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const next = `${window.location.pathname}${window.location.search}`;
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        queryParams: { prompt: "select_account" },
      },
    });

    if (signInError) setError("Google sign-in could not start. Please try again.");
  }, [supabase]);

  const signOut = useCallback(async () => {
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) setError("Sign-out failed. Please try again.");
  }, [supabase]);

  const value = useMemo(
    () => ({ status, user, error, signInWithGoogle, signOut }),
    [status, user, error, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
