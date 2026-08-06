// crosschain/abi.js
//
// Single source of truth for every ABI the worker touches.
//
// The v2 `Redeemed` event is defined TWICE on purpose, exactly like v1 did:
//   - REDEEMED_ABI   : viem object form  -> watchContractEvent / decodeEventLog
//   - REDEEMED_EVENT : parseAbiItem form -> getLogs
// Both MUST stay byte-for-byte compatible with the Solidity event:
//
//   event Redeemed(
//       uint256 indexed tokenId,
//       address indexed recipient,
//       string  chain,
//       bytes   assetAddress,
//       uint256 assetTokenId,
//       bool    isERC20,
//       uint256 amount,
//       bytes   data
//   );

const { parseAbiItem } = require('viem');

// Used by viem.watchContractEvent / decodeEventLog (object form).
const REDEEMED_ABI = [
  {
    type: 'event',
    name: 'Redeemed',
    anonymous: false,
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'chain', type: 'string', indexed: false },
      { name: 'assetAddress', type: 'bytes', indexed: false },
      { name: 'assetTokenId', type: 'uint256', indexed: false },
      { name: 'isERC20', type: 'bool', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'data', type: 'bytes', indexed: false },
    ],
  },
];

// Used by viem.getLogs (single AbiItem form).
const REDEEMED_EVENT = parseAbiItem(
  'event Redeemed(uint256 indexed tokenId, address indexed recipient, string chain, bytes assetAddress, uint256 assetTokenId, bool isERC20, uint256 amount, bytes data)'
);

// ethers v6 human-readable ABIs for the delivery side.
const ERC721_ABI = [
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

// Minimal ERC20 surface: balanceOf + transfer are required, decimals/symbol are
// best-effort and only ever used to make the logs readable.
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

module.exports = {
  REDEEMED_ABI,
  REDEEMED_EVENT,
  ERC721_ABI,
  ERC20_ABI,
};
