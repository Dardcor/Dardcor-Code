
export function cn(...classes) {
  return classes
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

