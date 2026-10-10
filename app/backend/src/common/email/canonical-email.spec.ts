import { canonicalizeEmail } from './canonical-email';

describe('canonicalizeEmail', () => {
  test('gmail: dots and plus tags collapse to one mailbox', () => {
    expect(canonicalizeEmail('John.Doe+spam@gmail.com')).toBe(
      'johndoe@gmail.com',
    );
    expect(canonicalizeEmail('j.o.h.n.d.o.e@gmail.com')).toBe(
      'johndoe@gmail.com',
    );
    expect(canonicalizeEmail('johndoe@gmail.com')).toBe('johndoe@gmail.com');
  });

  test('googlemail.com folds into gmail.com', () => {
    expect(canonicalizeEmail('John.Doe@googlemail.com')).toBe(
      'johndoe@gmail.com',
    );
  });

  test('outlook family: plus tag cut, dots kept', () => {
    expect(canonicalizeEmail('john.doe+spam@outlook.com')).toBe(
      'john.doe@outlook.com',
    );
    expect(canonicalizeEmail('john.doe@hotmail.com')).toBe(
      'john.doe@hotmail.com',
    );
    expect(canonicalizeEmail('john+doe@live.com')).toBe('john@live.com');
  });

  test('other domains: only trim + lowercase', () => {
    expect(canonicalizeEmail('  John.Doe+spam@Example.COM ')).toBe(
      'john.doe+spam@example.com',
    );
  });

  test('degenerate inputs pass through as trim+lowercase', () => {
    expect(canonicalizeEmail('not-an-email')).toBe('not-an-email');
    expect(canonicalizeEmail('+tag@gmail.com')).toBe('+tag@gmail.com');
    expect(canonicalizeEmail('...@gmail.com')).toBe('...@gmail.com');
    expect(canonicalizeEmail('@gmail.com')).toBe('@gmail.com');
  });
});
