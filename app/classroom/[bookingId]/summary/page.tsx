import { ClassroomLoader } from "@/app/components/classroom/classroom-loader";

export default async function ClassroomSummaryPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return <ClassroomLoader bookingId={bookingId} summary />;
}
