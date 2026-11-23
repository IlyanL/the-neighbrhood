import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings so later classes win over earlier ones.
 * Every shadcn/ui component in `components/ui/` depends on this.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
