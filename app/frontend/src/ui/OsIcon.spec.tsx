import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { OsIcon } from './OsIcon';

test('ubuntu: буква U, семейство в data-os, исходная строка в подсказке', () => {
  render(<OsIcon osName="Ubuntu 22.04.3 LTS" />);
  const icon = screen.getByRole('img', { name: 'Ubuntu 22.04.3 LTS' });
  expect(icon).toHaveTextContent('U');
  expect(icon).toHaveAttribute('data-os', 'ubuntu');
  expect(icon).toHaveAttribute('title', 'Ubuntu 22.04.3 LTS');
});

test('фолбэк uname: общий Linux без дистрибутива', () => {
  render(<OsIcon osName="Linux 5.15.0-91-generic (x86_64)" />);
  const icon = screen.getByRole('img', {
    name: 'Linux 5.15.0-91-generic (x86_64)',
  });
  expect(icon).toHaveTextContent('L');
  expect(icon).toHaveAttribute('data-os', 'linux');
});

test('ОС не опознана: «?» и честная подпись вместо выдуманной системы', () => {
  render(<OsIcon osName={null} />);
  const icon = screen.getByRole('img', { name: 'ОС не определена' });
  expect(icon).toHaveTextContent('?');
  expect(icon).toHaveAttribute('data-os', 'unknown');
});

test('незнакомое семейство: буква из строки, значение не подменяется', () => {
  render(<OsIcon osName="FreeBSD 14.0-RELEASE" />);
  const icon = screen.getByTitle('FreeBSD 14.0-RELEASE');
  expect(icon).toHaveTextContent('F');
  expect(icon).toHaveAttribute('data-os', 'other');
});
