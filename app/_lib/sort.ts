export type SortOption = "trending" | "newest" | "mcap" | "graduated";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "newest", label: "Newest" },
  { value: "mcap", label: "Top mcap" },
  { value: "graduated", label: "Graduated" },
];
