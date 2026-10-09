import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

// Базовый чёрный список: служебные имена + грубая лексика (EN/RU).
// Проверка — точное совпадение после lowercasing, чтобы не блокировать
// нормальные имена вроде "tester" или "adminov".
export const RESERVED_USERNAMES = new Set([
  // служебные
  'admin',
  'administrator',
  'root',
  'superuser',
  'system',
  'support',
  'help',
  'info',
  'security',
  'abuse',
  'postmaster',
  'hostmaster',
  'webmaster',
  'api',
  'www',
  'mail',
  'email',
  'moderator',
  'mod',
  'owner',
  'bios',
  'test',
  'guest',
  'user',
  'null',
  'undefined',
  // EN profanity
  'fuck',
  'shit',
  'bitch',
  'whore',
  'dick',
  'pussy',
  'asshole',
  'bastard',
  // RU profanity
  'хуй',
  'пизда',
  'ебать',
  'блядь',
  'сука',
  'пидор',
  'хуесос',
  'еблан',
  'говно',
  'мразь',
]);

@ValidatorConstraint({ name: 'isNotReservedUsername', async: false })
class IsNotReservedUsernameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return !RESERVED_USERNAMES.has(value.toLowerCase());
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} "${args.value}" is reserved and cannot be used`;
  }
}

export function IsNotReservedUsername(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsNotReservedUsernameConstraint,
    });
  };
}
