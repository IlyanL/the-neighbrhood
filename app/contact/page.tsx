import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/components/policy-page";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach The Neighbrhood for account, product, and safety questions.",
};

export default function ContactPage() {
  return (
    <PolicyPage title="Contact" intro="How to reach The Neighbrhood for account, product, privacy, and safety questions." updated="October 15, 2026">
      <PolicySection title="Send us a message">
        <p>Account trouble, a booking or payment question, a bug, or anything else. It reaches the team&rsquo;s inbox and we reply within 2 business days.</p>
        <ContactForm />
      </PolicySection>
      <PolicySection title="Prefer email?">
        <p>Write to <a href="mailto:support@theneighbrhood.ca">support@theneighbrhood.ca</a>. Signed-in users can also use the reporting action attached to a relevant listing.</p>
      </PolicySection>
      <PolicySection title="Privacy and your data">
        <p>Use the form above (pick &ldquo;Privacy or deleting my data&rdquo;) or email <a href="mailto:support@theneighbrhood.ca">support@theneighbrhood.ca</a> to ask what information we hold about you, to correct it, or to have your account and associated data deleted. Include the email address on your account so we can find it. We confirm deletion requests within 2 business days.</p>
      </PolicySection>
      <PolicySection title="Urgent safety">
        <p>For immediate danger, contact emergency services or Western Campus Safety rather than waiting for a product response.</p>
      </PolicySection>
    </PolicyPage>
  );
}
