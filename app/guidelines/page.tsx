import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/components/policy-page";
export const metadata: Metadata = {
  title: "Community guidelines",
  description: "Standards for a useful, respectful Western student network on The Neighbrhood.",
};
export default function GuidelinesPage() { return <PolicyPage title="Community guidelines" intro="Standards for a useful, respectful Western student network." updated="September 22, 2026"><PolicySection title="Be truthful"><p>Post only real opportunities, events, course information, and services. Do not impersonate another person or organization.</p></PolicySection><PolicySection title="Be constructive"><p>Keep course discussions helpful. Harassment, discrimination, spam, academic misconduct, and attempts to move unsafe activity through the platform are not allowed.</p></PolicySection><PolicySection title="Protect privacy"><p>Share only what is needed. Never publish another person’s private contact, academic, financial, or identity information without permission.</p></PolicySection></PolicyPage>; }
