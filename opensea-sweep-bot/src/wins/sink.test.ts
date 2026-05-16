import { describe, expect, it } from 'vitest';
import { buildGameEndedRow, type DecodedGameEnded } from './sink';

function decoded(overrides: Partial<DecodedGameEnded> = {}): DecodedGameEnded {
  return {
    txHash: '0xD7DB4AD2016543024D37EB862F4CBF85F62ECD10E9ECD43373C66EBC803EEB11',
    logIndex: 1,
    blockNumber: 12_345_678n,
    blockTimestampUnix: 1_777_086_013,
    gameAddress: '0x17E219844F25F3FED6E422DDAFFD2E6557EBCED3',
    user: '0xD7E916A30EF8EB42A8E1423ED8AED13BCB43F99E',
    gameId: 1_777_086_010_743_918_283n,
    buyIn: 231_652_870_582_887_944_164n,
    payout: 240_270_357_368_571_375_686n,
    ...overrides,
  };
}

describe('buildGameEndedRow', () => {
  it('matches the subgraph-style event_id (`${lowercase-tx}-${decimal-logIndex}`)', () => {
    const row = buildGameEndedRow(decoded());
    expect(row.event_id).toBe(
      '0xd7db4ad2016543024d37eb862f4cbf85f62ecd10e9ecd43373c66ebc803eeb11-1',
    );
  });

  it('lowercases tx hash, game address, and user address', () => {
    const row = buildGameEndedRow(decoded());
    expect(row.game_address).toBe('0x17e219844f25f3fed6e422ddaffd2e6557ebced3');
    expect(row.user_address).toBe('0xd7e916a30ef8eb42a8e1423ed8aed13bcb43f99e');
    expect(row.event_id.startsWith('0x')).toBe(true);
    expect(row.event_id).toBe(row.event_id.toLowerCase());
  });

  it('serializes bigint values to decimal strings (no scientific notation, no precision loss)', () => {
    const row = buildGameEndedRow(decoded());
    expect(row.game_id).toBe('1777086010743918283');
    expect(row.buy_in_wei).toBe('231652870582887944164');
    expect(row.payout_wei).toBe('240270357368571375686');
  });

  it('writes block_timestamp as ISO 8601 (timestamptz-friendly)', () => {
    const row = buildGameEndedRow(decoded());
    // 1_777_086_013 → 2026-04-25T03:00:13.000Z
    expect(row.block_timestamp).toBe('2026-04-25T03:00:13.000Z');
  });

  it('does NOT include profit_wei (it is GENERATED ALWAYS by Postgres)', () => {
    const row = buildGameEndedRow(decoded()) as unknown as Record<string, unknown>;
    expect('profit_wei' in row).toBe(false);
  });

  it('emits raw in the subgraph shape so other consumers keep working', () => {
    const row = buildGameEndedRow(decoded());
    expect(row.raw).toEqual({
      id: '0xd7db4ad2016543024d37eb862f4cbf85f62ecd10e9ecd43373c66ebc803eeb11-1',
      game: { id: '0x17e219844f25f3fed6e422ddaffd2e6557ebced3' },
      user: { id: '0xd7e916a30ef8eb42a8e1423ed8aed13bcb43f99e' },
      buyIn: '231652870582887944164',
      gameId: '1777086010743918283',
      payout: '240270357368571375686',
      timestamp: '1777086013',
    });
  });

  it('handles a free bet (buyIn=0) without dividing by zero', () => {
    const row = buildGameEndedRow(
      decoded({ buyIn: 0n, payout: 5_000_000_000_000_000_000_000n }),
    );
    expect(row.buy_in_wei).toBe('0');
    expect(row.payout_wei).toBe('5000000000000000000000');
  });
});
