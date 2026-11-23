import { ClassroomLoader } from "@/app/components/classroom/classroom-loader";

export default async function ClassroomPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  return <ClassroomLoader bookingId={bookingId} />;
}
