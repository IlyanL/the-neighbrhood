import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/components/policy-page";
export const metadata: Metadata = {
  title: "Terms",
  description: "Plain-language conditions for using The Neighbrhood during its campus launch.",
};
export default function TermsPage() { return <PolicyPage title="Terms" intro="Plain-language conditions for using The Neighbrhood during its campus launch." updated="September 22, 2026"><PolicySection title="Eligibility"><p>You must use a verified Western University account and provide accurate information about yourself, listings, events, and tutoring services.</p></PolicySection><PolicySection title="Transactions"><p>Tutoring session payments are collected securely through Stripe once a tutor confirms a session; The Neighbrhood does not store your card details. Housing arrangements remain the responsibility of the students involved and are never paid for on this platform.</p></PolicySection><PolicySection title="Access"><p>We may restrict content or accounts that are unsafe, misleading, unauthorized, or harmful to the campus community.</p></PolicySection></PolicyPage>; }
