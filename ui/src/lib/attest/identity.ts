// Athlete identity derived from the OAuth exchange — the UI's dynamic
// username, replacing the hardcoded demo names (Ava/Milo/…). The handle is
// left unset unless the service starts returning one; Round 2 may derive it.

import type { StravaExchangeResponse } from "./strava";

export interface AthleteIdentity {
  name: string;
  stravaId: number;
  stravaHandle?: string;
}

export function athleteIdentityFromExchange(exchange: StravaExchangeResponse): AthleteIdentity {
  const { athlete } = exchange;
  return {
    name: `${athlete.firstname} ${athlete.lastname}`.trim(),
    stravaId: athlete.id,
  };
}
