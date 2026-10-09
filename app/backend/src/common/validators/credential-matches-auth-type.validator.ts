import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

type CredentialCarrier = { sshPassword?: unknown; sshPrivateKey?: unknown };

const present = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0;

@ValidatorConstraint({ name: 'credentialMatchesAuthType', async: false })
class CredentialMatchesAuthTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const object = args.object as CredentialCarrier;
    const password = present(object.sshPassword);
    const key = present(object.sshPrivateKey);
    if (value === 'PASSWORD') return password && !key;
    if (value === 'KEY') return key && !password;
    // Неизвестный authType — не наша проблема: @IsIn уже даёт 400.
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const object = args.object as CredentialCarrier;
    const declared =
      args.value === 'PASSWORD' ? 'sshPassword' : 'sshPrivateKey';
    const other = args.value === 'PASSWORD' ? 'sshPrivateKey' : 'sshPassword';
    if (present(object[other])) {
      return `${declared} is required and ${other} must be omitted for authType ${String(args.value)}`;
    }
    return `${declared} is required for authType ${String(args.value)}`;
  }
}

/**
 * Проверка «declared authType ↔ ровно один креденшел» живёт на обязательном поле
 * authType, потому что @ValidateIf пропускает свойство ЦЕЛИКОМ (проверено на
 * class-validator 0.15.1): на факультативных полях такой констрейнт не выполнился
 * бы при отсутствии обоих креденшелов.
 */
export function CredentialMatchesAuthType(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: CredentialMatchesAuthTypeConstraint,
    });
  };
}
