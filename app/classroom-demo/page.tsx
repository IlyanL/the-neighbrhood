import type { Metadata } from "next";
import { ClassroomDemoLoader } from "@/app/components/classroom/classroom-demo-loader";

export const metadata: Metadata = {
  title: "Try the tutoring classroom · The Neighbrhood",
  description: "A free look at the whiteboard, chat and video tools every Neighbrhood tutoring session runs on. No account needed.",
};

export default function ClassroomDemoPage() {
  return <ClassroomDemoLoader />;
}
