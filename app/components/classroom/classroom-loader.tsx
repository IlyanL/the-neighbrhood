"use client";

import dynamic from "next/dynamic";
import { NeighbrhoodLoader } from "@/app/components/brand";

const ClassroomClient = dynamic(
  () => import("@/app/components/classroom/classroom-client").then((module) => module.ClassroomClient),
  {
    ssr: false,
    loading: () => <main className="classroom-loading"><div><NeighbrhoodLoader label="Preparing your classroom" /><h1>Preparing your classroom…</h1><p>Connecting your private session tools.</p></div></main>,
  },
);

export function ClassroomLoader(props: { bookingId: string; summary?: boolean }) {
  return <ClassroomClient {...props} />;
}
