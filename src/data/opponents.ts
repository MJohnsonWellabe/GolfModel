import { Golfer } from '../core/types';

/** AI opponents — modeled after real golfers but not identical. */
export const OPPONENTS: Golfer[] = [
  {
    id: 'tiger',
    name: 'Tiger',
    color: 0xcc2222,
    look: { skin: 0xc68a5a, shirt: 0xcc2222, hat: 0x222222, hair: null },
    stats: {
      drivingPower: 95,
      drivingAccuracy: 85,
      approach: 90,
      chipping: 85,
      putting: 90
    }
  },
  {
    id: 'sergio',
    name: 'Sergio',
    color: 0xe0b03a,
    look: { skin: 0xd9a878, shirt: 0xe0b03a, hat: 0xf5f5f0, hair: 0x3a2e22 },
    stats: {
      drivingPower: 88,
      drivingAccuracy: 92,
      approach: 90,
      chipping: 85,
      putting: 85
    }
  },
  {
    id: 'phil',
    name: 'Phil',
    color: 0x3a3f4a,
    look: { skin: 0xf0c8a0, shirt: 0x3a3f4a, hat: null, hair: 0x6b6258 },
    stats: {
      drivingPower: 90,
      drivingAccuracy: 80,
      approach: 92,
      chipping: 90,
      putting: 88
    }
  },
  {
    id: 'rory',
    name: 'Rory',
    color: 0x2f8f5b,
    look: { skin: 0xf0c8a0, shirt: 0x2f8f5b, hat: 0xf5f5f0, hair: 0x4a3524 },
    stats: {
      drivingPower: 96,
      drivingAccuracy: 82,
      approach: 88,
      chipping: 85,
      putting: 85
    }
  }
];
