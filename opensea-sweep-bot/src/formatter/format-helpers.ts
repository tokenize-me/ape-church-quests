const DISPLAY_DECIMALS: Record<string, number> = {
  ETH: 4,
  WETH: 4,
  APE: 2,
  WAPE: 2,
  USDC: 2,
  USDT: 2,
  DAI: 2,
};

const DEFAULT_DECIMALS = 4;

export function displayDecimals(currency: string): number {
  return DISPLAY_DECIMALS[currency.toUpperCase()] ?? DEFAULT_DECIMALS;
}

export function formatNative(amount: number, currency: string): string {
  const decimals = displayDecimals(currency);
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
