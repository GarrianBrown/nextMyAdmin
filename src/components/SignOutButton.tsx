"use client";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Shown in the header only when the web login (NMA_PASSWORD) is on. */
export default function SignOutButton() {
  async function signOut() {
    await fetch(`${BASE}/api/login`, { method: "DELETE" }).catch(() => {});
    window.location.assign(`${BASE}/login`);
  }
  return (
    <button type="button" className="btn text-sm" onClick={signOut}>
      Sign out
    </button>
  );
}
