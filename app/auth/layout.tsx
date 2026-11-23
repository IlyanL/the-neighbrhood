import type { Metadata } from "next";

// page.tsx here is "use client" (it drives the sign-in/join form with hooks),
// and a Metadata export only works from a Server Component. A layout is the
// smallest wrapper that can carry it without touching the page itself.
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or join The Neighbrhood with a verified @uwo.ca email.",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
