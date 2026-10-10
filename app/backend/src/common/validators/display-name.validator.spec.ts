import { DISPLAY_NAME_PATTERN } from './display-name.validator';

describe('DISPLAY_NAME_PATTERN', () => {
  const valid = [
    'Team Alpha',
    'prod-1',
    'srv_db#2',
    'Команда_1',
    '服务器 #3',
    'a',
    'x'.repeat(64),
  ];
  const invalid: Array<[string, string]> = [
    ['<script>alert(1)</script>', 'html/js'],
    ['a"b', 'double quote'],
    ["a'b", 'single quote'],
    ['a;b', 'semicolon'],
    ['a/b', 'slash'],
    ['a\\b', 'backslash'],
    ['a@b', 'at sign'],
    ['a!b', 'exclamation'],
    ['a$b', 'dollar'],
    ['a`b', 'backtick'],
    ['$(whoami)', 'command substitution'],
    ['hello😀', 'emoji'],
    ['🇷🇺flag', 'flag emoji'],
    ['a'.repeat(65), 'too long'],
    ['', 'empty'],
  ];

  test.each(valid)('accepts %p', (name) => {
    expect(DISPLAY_NAME_PATTERN.test(name)).toBe(true);
  });

  test.each(invalid)('rejects %p (%s)', (name) => {
    expect(DISPLAY_NAME_PATTERN.test(name)).toBe(false);
  });
});
