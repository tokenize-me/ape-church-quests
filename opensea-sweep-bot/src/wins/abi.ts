// Shared GameEnded ABI fragment. All 31 game contracts emit this exact
// signature, so a single fragment covers every address in TRACKED_GAME_ADDRESSES.
// Only `user` is indexed.
export const GAME_ENDED_ABI = [
  {
    type: 'event',
    name: 'GameEnded',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'gameId', type: 'uint256', indexed: false },
      { name: 'buyIn', type: 'uint256', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
    ],
  },
] as const;
