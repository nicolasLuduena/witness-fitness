import type { Athlete } from "../domain/types";

const compactBinding = (binding: string): string => {
  const normalized = binding.replace(/^0x/, "").toUpperCase();
  if (normalized.length < 10) return normalized || "UNAVAILABLE";
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
};

export const athleteLabel = (athlete: Athlete): string =>
  athlete.role === "local" ? "You" : compactBinding(athlete.holderBinding);

export const opponentLabel = (athlete: Athlete): string =>
  compactBinding(athlete.holderBinding);
