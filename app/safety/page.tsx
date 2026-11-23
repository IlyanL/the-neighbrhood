import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/components/policy-page";
export const metadata: Metadata = {
  title: "Safety",
  description: "Practical precautions for tutoring, housing, events, and student-to-student contact.",
};
export default function SafetyPage() { return <PolicyPage title="Safety" intro="Practical precautions for tutoring, housing, events, and student-to-student contact." updated="September 22, 2026"><PolicySection title="Meet thoughtfully"><p>Prefer public campus locations for first meetings, tell someone where you are going, and use platform messaging until you are comfortable.</p></PolicySection><PolicySection title="Housing"><p>Verify the property and person before signing or paying. Never send deposits solely because a listing appears here.</p></PolicySection><PolicySection title="Urgent concerns"><p>For immediate danger contact emergency services or Western Campus Safety. Use Contact for product reports that are not emergencies.</p></PolicySection></PolicyPage>; }
