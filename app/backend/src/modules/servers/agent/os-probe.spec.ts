import {
  buildOsProbeCommand,
  OS_NAME_MAX,
  parseOsName,
} from './os-probe';

const HOSTNAMECTL = [
  '   Static hostname: prod-1',
  '         Icon name: computer-vm',
  '           Chassis: vm',
  '        Machine ID: 8f4b7c1e2a',
  '   Operating System: Ubuntu 22.04.3 LTS',
  '             Kernel: Linux 5.15.0-91-generic',
  '       Architecture: x86-64',
].join('\n');

const UNAME =
  'Linux prod-1 5.15.0-91-generic #101-Ubuntu SMP Fri Nov 24 19:00:00 UTC 2023 x86_64 x86_64 x86_64 GNU/Linux';

describe('os probe', () => {
  test('команда: hostnamectl с заглушённым stderr; uname — фолбэк в том же шаге', () => {
    const command = buildOsProbeCommand();
    expect(command).toContain('hostnamectl 2>/dev/null');
    expect(command).toContain('uname -a');
  });

  test('hostnamectl: человекочитаемое имя дистрибутива приоритетнее uname', () => {
    expect(parseOsName(`${HOSTNAMECTL}\n${UNAME}\n`)).toBe('Ubuntu 22.04.3 LTS');
  });

  test('без systemd (hostnamectl молчит, stderr заглушён): строка из uname', () => {
    expect(parseOsName(`${UNAME}\n`)).toBe('Linux 5.15.0-91-generic (x86_64)');
  });

  test('старая ОС: ядро CentOS из uname всё равно даёт опознаваемую строку', () => {
    expect(
      parseOsName(
        'Linux old-host 3.10.0-1160.el7.x86_64 #1 SMP Mon Oct 19 16:18:59 UTC 2020 x86_64 x86_64 x86_64 GNU/Linux\n',
      ),
    ).toBe('Linux 3.10.0-1160.el7.x86_64 (x86_64)');
  });

  test('пустой Operating System не мешает фолбэку на uname', () => {
    expect(parseOsName(`Operating System:   \n${UNAME}\n`)).toBe(
      'Linux 5.15.0-91-generic (x86_64)',
    );
  });

  test('ни hostnamectl, ни uname не распознались → null (не выдумываем ОС)', () => {
    expect(parseOsName('')).toBeNull();
    expect(parseOsName('bash: hostnamectl: command not found\n')).toBeNull();
    expect(parseOsName('Linux host 5.15.0-91-generic #101 SMP x86_64')).toBeNull();
  });

  test('управляющие символы вычищаются, длина ограничена', () => {
    expect(parseOsName('Operating System: De\u0000bia\u001bn\r\n')).toBe(
      'De bia n',
    );
    const long = `Operating System: ${'D'.repeat(200)}\n`;
    expect(parseOsName(long)).toHaveLength(OS_NAME_MAX);
  });
});
