import { Golfer } from '../core/types';

/** Playable golfers. Stats: driving power, driving accuracy, approach, chipping, putting. */
export const GOLFERS: Golfer[] = [
  {
    id: 'zac',
    name: 'Zac',
    color: 0xe05353,
    // Late 30s, buff, short hair, polo, 5-inch shorts, white hat.
    look: { skin: 0xf0c8a0, shirt: 0xe05353, hat: 0xf5f5f0, hair: 0x5a4632 },
    // 3D game: armored "Knight" body from the chibi character pack.
    model3d: 'knight',
    stats: {
      drivingPower: 90,
      drivingAccuracy: 75,
      approach: 80,
      chipping: 85,
      putting: 85
    }
  },
  {
    id: 'matt',
    name: 'Matt',
    color: 0x4d8fe0,
    // Late 30s, athletic, bald, blue polo, light blue hat, white pants.
    look: { skin: 0xf0c8a0, shirt: 0x2f6bb0, hat: 0x9ec7f0, hair: null },
    // 3D game: "Ninja" body from the chibi character pack.
    model3d: 'ninja',
    stats: {
      drivingPower: 91,
      drivingAccuracy: 80,
      approach: 85,
      chipping: 80,
      putting: 80
    }
  },
  {
    id: 'jeff',
    name: 'Jeff',
    color: 0xd9a441,
    // Early 60s, chubby, buzz cut, oversized polo, shorts.
    look: { skin: 0xf2cfae, shirt: 0xe8e2d0, hat: null, hair: 0x9a9a94 },
    stats: {
      drivingPower: 75,
      drivingAccuracy: 90,
      approach: 85,
      chipping: 90,
      putting: 90
    }
  },
  {
    id: 'parker',
    name: 'Parker',
    color: 0x6bbf47,
    // 7-year-old boy, dinosaur T-shirt and cap.
    look: {
      skin: 0xf0c8a0,
      shirt: 0x6bbf47,
      hat: 0xd23c3c,
      hair: 0x5a4632,
      motif: 'dino',
      child: true
    },
    stats: {
      drivingPower: 100,
      drivingAccuracy: 75,
      approach: 85,
      chipping: 82,
      putting: 88
    }
  },
  {
    id: 'oliver',
    name: 'Oliver',
    color: 0xf2cc3a,
    // Kid with a yellow Pikachu-outline shirt and a red/blue Pokéball cap.
    look: {
      skin: 0xf0c8a0,
      shirt: 0xf2cc3a,
      hat: 0xd23c3c,
      hatSecondary: 0x2f6bb0,
      hair: 0x3a2e22,
      motif: 'pikachu',
      child: true
    },
    stats: {
      drivingPower: 85,
      drivingAccuracy: 85,
      approach: 84,
      chipping: 86,
      putting: 100
    }
  },
  {
    id: 'emery',
    name: 'Emery',
    color: 0xe91e63,
    // 11-year-old tall girl, light brown hair with a pink streak,
    // pink dress with a heart on the front. Approach specialist.
    look: {
      skin: 0xf0c8a0,
      shirt: 0xe91e63,
      hat: null,
      hair: 0xa8834f,
      hairStreak: 0xff6fb0,
      dress: true,
      longHair: true,
      motif: 'heart'
    },
    stats: {
      drivingPower: 82,
      drivingAccuracy: 85,
      approach: 100,
      chipping: 85,
      putting: 86
    }
  },
  {
    id: 'charlotte',
    name: 'Charlotte',
    color: 0xf06292,
    // 4-year-old girl, long blonde hair, no cap, cute pink dress.
    look: {
      skin: 0xf5d5b5,
      shirt: 0xf48fb1,
      hat: null,
      hair: 0xf3e08a,
      dress: true,
      longHair: true,
      child: true
    },
    stats: {
      drivingPower: 75,
      drivingAccuracy: 100,
      approach: 84,
      chipping: 88,
      putting: 90
    }
  }
];
