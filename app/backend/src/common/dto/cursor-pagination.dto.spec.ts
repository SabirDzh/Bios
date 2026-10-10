import { BadRequestException } from '@nestjs/common';
import {
  decodeCursorOrThrow,
  encodeCursor,
  takePage,
} from './cursor-pagination.dto';

describe('cursor pagination helpers', () => {
  test('encode/decode round-trip', () => {
    const ts = new Date('2026-10-10T12:00:00.000Z');
    const cursor = encodeCursor(ts, 'abc-123');
    expect(decodeCursorOrThrow(cursor)).toEqual({
      ts: '2026-10-10T12:00:00.000Z',
      id: 'abc-123',
    });
  });

  test('garbage cursor fails fast with 400', () => {
    for (const bad of [
      'not-base64!!!',
      Buffer.from('[]', 'utf8').toString('base64url'),
      Buffer.from('{"ts":"nope","id":"x"}', 'utf8').toString('base64url'),
      Buffer.from('{"ts":"2026-01-01T00:00:00Z"}', 'utf8').toString(
        'base64url',
      ),
      Buffer.from('{"ts":"2026-01-01T00:00:00Z","id":""}', 'utf8').toString(
        'base64url',
      ),
    ]) {
      expect(() => decodeCursorOrThrow(bad)).toThrow(BadRequestException);
    }
  });

  test('takePage: full page yields nextCursor, last page yields null', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const full = takePage(rows, 2, (r) => `cursor-${r.id}`);
    expect(full.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(full.nextCursor).toBe('cursor-b');
    const last = takePage(rows.slice(0, 2), 2, (r) => `cursor-${r.id}`);
    expect(last.items).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
  });
});
