export type SortOption = "newest" | "oldest" | "graduated";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "graduated", label: "Graduated" },
];
