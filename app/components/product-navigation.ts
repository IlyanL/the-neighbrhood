export type ViewName =
  | "Home"
  | "Courses"
  | "Explore"
  | "View Tutors"
  | "Housing"
  | "Clubs"
  | "Profile"
  | "Tutor Profile"
  | "Settings"
  | "My Sessions"
  | "Chat"
  | "Contact Us"
  | "Admin";

export type ExploreCategory = "tutors" | "clubs" | "events" | "housing";
export type SessionTab = "requests" | "upcoming" | "past";

export type NavigationTarget = {
  courseId?: string;
  discussionId?: string;
  eventId?: string;
  clubId?: string;
  tutorId?: string;
  listingId?: string;
  bookingId?: string;
  threadId?: string;
  sessionTab?: SessionTab;
  exploreCategory?: ExploreCategory;
  compose?: "housing";
  query?: string;
};

export type ProductLocation = NavigationTarget & { view: ViewName };

const views: ViewName[] = ["Home", "Courses", "Explore", "View Tutors", "Housing", "Clubs", "Profile", "Tutor Profile", "Settings", "My Sessions", "Chat", "Contact Us", "Admin"];
const categories: ExploreCategory[] = ["tutors", "clubs", "events", "housing"];
const sessionTabs: SessionTab[] = ["requests", "upcoming", "past"];

export function readProductLocation(search: string): ProductLocation {
  const params = new URLSearchParams(search);
  const rawView = params.get("view");
  const view = rawView && views.includes(rawView as ViewName) ? rawView as ViewName : "Home";
  const category = params.get("category");
  const sessionTab = params.get("sessionTab");
  return {
    view,
    courseId: params.get("course") || undefined,
    discussionId: params.get("discussion") || undefined,
    eventId: params.get("event") || undefined,
    clubId: params.get("club") || undefined,
    tutorId: params.get("tutor") || undefined,
    listingId: params.get("listing") || undefined,
    bookingId: params.get("booking") || undefined,
    threadId: params.get("thread") || undefined,
    sessionTab: sessionTab && sessionTabs.includes(sessionTab as SessionTab) ? sessionTab as SessionTab : undefined,
    exploreCategory: category && categories.includes(category as ExploreCategory) ? category as ExploreCategory : undefined,
    compose: params.get("compose") === "housing" ? "housing" : undefined,
    query: params.get("q") || undefined,
  };
}

export function productUrl(view: ViewName, target: NavigationTarget = {}) {
  if (view === "Home" && Object.keys(target).length === 0) return "/";
  const params = new URLSearchParams({ view });
  const values: Array<[string, string | undefined]> = [
    ["course", target.courseId],
    ["discussion", target.discussionId],
    ["event", target.eventId],
    ["club", target.clubId],
    ["tutor", target.tutorId],
    ["listing", target.listingId],
    ["booking", target.bookingId],
    ["thread", target.threadId],
    ["sessionTab", target.sessionTab],
    ["category", target.exploreCategory],
    ["compose", target.compose],
    ["q", target.query],
  ];
  values.forEach(([key, value]) => { if (value) params.set(key, value); });
  return `/?${params.toString()}`;
}
