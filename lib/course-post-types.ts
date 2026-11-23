export const coursePostTypes = [
  { value: "question", label: "Question" },
  { value: "discussion", label: "Discussion" },
] as const;

export type CoursePostType = (typeof coursePostTypes)[number]["value"];

export function coursePostTypeLabel(value: string) {
  return coursePostTypes.find((type) => type.value === value)?.label ?? "Post";
}
