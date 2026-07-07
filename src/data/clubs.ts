import { ClubSpec } from '../core/types';

/**
 * The bag. baseDistance = full-power carry in yards from a perfect lie.
 * spin: higher = less rollout after landing.
 */
export const CLUBS: ClubSpec[] = [
  { id: 'driver', name: 'Driver', baseDistance: 270, launchAngle: 11, spin: 0.15 },
  { id: '3w', name: '3W', baseDistance: 235, launchAngle: 13, spin: 0.2 },
  { id: '5w', name: '5W', baseDistance: 215, launchAngle: 15, spin: 0.25 },
  { id: '3i', name: '3I', baseDistance: 200, launchAngle: 15, spin: 0.28 },
  { id: '5i', name: '5I', baseDistance: 180, launchAngle: 18, spin: 0.34 },
  { id: '7i', name: '7I', baseDistance: 160, launchAngle: 21, spin: 0.45 },
  { id: '9i', name: '9I', baseDistance: 135, launchAngle: 25, spin: 0.58 },
  { id: 'pw', name: 'PW', baseDistance: 110, launchAngle: 29, spin: 0.72 },
  { id: 'sw', name: 'SW', baseDistance: 80, launchAngle: 34, spin: 0.85 },
  { id: 'putter', name: 'Putter', baseDistance: 40, launchAngle: 0, spin: 0 }
];

export function clubById(id: string): ClubSpec {
  const club = CLUBS.find((c) => c.id === id);
  if (!club) throw new Error(`Unknown club: ${id}`);
  return club;
}
