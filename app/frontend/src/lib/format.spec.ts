import { expect, test } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatRelative,
  plural,
} from './format';

const NOW = new Date('2026-10-11T12:00:00Z');

test('граница «только что»', () => {
  expect(formatRelative('2026-10-11T11:59:16Z', NOW)).toBe('только что');
  expect(formatRelative('2026-10-11T11:59:15Z', NOW)).toBe('1 мин назад');
});

test('минуты, часы, дни', () => {
  expect(formatRelative('2026-10-11T11:30:00Z', NOW)).toBe('30 мин назад');
  expect(formatRelative('2026-10-11T09:00:00Z', NOW)).toBe('3 ч назад');
  expect(formatRelative('2026-10-08T12:00:00Z', NOW)).toBe('3 дн назад');
});

test('старше недели — точная дата', () => {
  expect(formatRelative('2026-09-30T12:00:00Z', NOW)).toBe('30 сент. 2026 г.');
});

test('пустое и невалидное значение — прочерк', () => {
  expect(formatRelative(null, NOW)).toBe('—');
  expect(formatRelative('не-дата', NOW)).toBe('—');
});

test('plural: русские формы числа', () => {
  const f = (n: number) => plural(n, 'сервер', 'сервера', 'серверов');
  expect(f(1)).toBe('сервер');
  expect(f(2)).toBe('сервера');
  expect(f(4)).toBe('сервера');
  expect(f(5)).toBe('серверов');
  expect(f(11)).toBe('серверов');
  expect(f(21)).toBe('сервер');
  expect(f(22)).toBe('сервера');
  expect(f(112)).toBe('серверов');
});

test('formatDuration: мс, десятые до 10 с, минуты, часы', () => {
  expect(formatDuration(0)).toBe('0 мс');
  expect(formatDuration(850)).toBe('850 мс');
  expect(formatDuration(3400)).toBe('3.4 с');
  expect(formatDuration(42_400)).toBe('42 с');
  expect(formatDuration(60_000)).toBe('1 мин');
  expect(formatDuration(125_000)).toBe('2 мин 5 с');
  expect(formatDuration(3_660_000)).toBe('1 ч 1 мин');
});

test('formatDuration: пустое значение — прочерк', () => {
  expect(formatDuration(null)).toBe('—');
  expect(formatDuration(undefined)).toBe('—');
  expect(formatDuration(Number.NaN)).toBe('—');
});

test('formatBytes: Б, КБ, МБ', () => {
  expect(formatBytes(0)).toBe('0 Б');
  expect(formatBytes(512)).toBe('512 Б');
  expect(formatBytes(1536)).toBe('1.5 КБ');
  expect(formatBytes(10_240)).toBe('10 КБ');
  expect(formatBytes(1_572_864)).toBe('1.5 МБ');
});

test('formatBytes: пустое значение — прочерк', () => {
  expect(formatBytes(null)).toBe('—');
  expect(formatBytes(undefined)).toBe('—');
});
