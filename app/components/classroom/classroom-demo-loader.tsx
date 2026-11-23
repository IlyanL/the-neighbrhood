"use client";

import dynamic from "next/dynamic";
import { NeighbrhoodLoader } from "@/app/components/brand";

const ClassroomDemo = dynamic(
  () => import("@/app/components/classroom/classroom-demo").then((module) => module.ClassroomDemo),
  {
    ssr: false,
    loading: () => <main className="classroom-loading"><div><NeighbrhoodLoader label="Preparing the demo" /><h1>Preparing the demo…</h1><p>Loading the whiteboard.</p></div></main>,
  },
);

export function ClassroomDemoLoader() {
  return <ClassroomDemo />;
}
