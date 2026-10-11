import { expect, test } from 'vitest';
import { osMeta } from './osMeta';

test('семейства распознаются по началу строки от hostnamectl', () => {
  const cases: Array<[string, string, string]> = [
    ['Ubuntu 22.04.3 LTS', 'ubuntu', 'U'],
    ['Debian GNU/Linux 12 (bookworm)', 'debian', 'D'],
    ['Kali GNU/Linux Rolling', 'kali', 'K'],
    ['Red Hat Enterprise Linux 9.2 (Plow)', 'rhel', 'R'],
    ['CentOS Linux 7 (Core)', 'centos', 'C'],
    ['Fedora Linux 38 (Server Edition)', 'fedora', 'F'],
    ['Rocky Linux 9.2 (Blue Onyx)', 'rocky', 'R'],
    ['AlmaLinux 9.2 (Turquoise Kodkod)', 'alma', 'A'],
    ['openSUSE Leap 15.5', 'suse', 'S'],
    ['Arch Linux', 'arch', 'A'],
    ['Manjaro Linux', 'manjaro', 'M'],
    ['Alpine Linux v3.18', 'alpine', 'A'],
    ['Gentoo Linux', 'gentoo', 'G'],
    ['Linux 3.10.0-1160.el7.x86_64 (x86_64)', 'linux', 'L'],
  ];
  for (const [raw, key, abbr] of cases) {
    expect(osMeta(raw)).toMatchObject({ key, abbr });
  }
});

test('null и пусто — ОС не опознана (карточка покажет «?»)', () => {
  expect(osMeta(null)).toBeNull();
  expect(osMeta(undefined)).toBeNull();
  expect(osMeta('   ')).toBeNull();
});

test('незнакомое семейство: буква из строки, подпись — исходный текст', () => {
  expect(osMeta('FreeBSD 14.0-RELEASE')).toEqual({
    key: 'other',
    abbr: 'F',
    label: 'FreeBSD 14.0-RELEASE',
  });
});
