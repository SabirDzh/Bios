import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CONTAINER_ID_RE, ContainerIdsDto } from './container-ids.dto';
import { ContainerActionDto } from './container-action.dto';

/**
 * Настоящие UUIDv7: иначе падения приходят от наследуемых @IsUUID('7'), а не от
 * нашего правила на containerId, и тест ничего не проверяет.
 */
const WS = '01a1234a-1b54-77a1-a741-efc2cf92d024';
const SRV = '01a1234a-1b77-7631-8ed5-e483aebbe64f';

function invalidProps(value: Record<string, unknown>): string[] {
  const dto = plainToInstance(ContainerIdsDto, value);
  return validateSync(dto, { whitelist: true }).map((e) => e.property);
}

describe('ContainerIdsDto', () => {
  test('принимает id и имя контейнера', () => {
    expect(
      invalidProps({ workspaceId: WS, serverId: SRV, containerId: 'a1b2c3d4' }),
    ).toEqual([]);
    expect(
      invalidProps({
        workspaceId: WS,
        serverId: SRV,
        containerId: 'my-app_1.2',
      }),
    ).toEqual([]);
  });

  test('отклоняет всё, что может изменить путь внутри Docker API', () => {
    for (const bad of [
      '..%2fcontainers',
      'a/b',
      '../../etc/passwd',
      '',
      ' lead-space',
      'x'.repeat(129),
    ]) {
      expect(
        invalidProps({ workspaceId: WS, serverId: SRV, containerId: bad }),
      ).toContain('containerId');
    }
  });

  test('чужие поля пути проверяются как UUIDv7', () => {
    expect(
      invalidProps({ workspaceId: 'x', serverId: SRV, containerId: 'ok' }),
    ).toContain('workspaceId');
    expect(
      invalidProps({ workspaceId: WS, serverId: '4', containerId: 'ok' }),
    ).toContain('serverId');
  });

  test('regex совпадает с тем, что принимает демон (64-символьный sha-id)', () => {
    expect(
      CONTAINER_ID_RE.test('e91e3ee4f0c1c3e2b1a0'.repeat(3).slice(0, 64)),
    ).toBe(true);
  });
});

describe('ContainerActionDto', () => {
  function invalidAction(value: Record<string, unknown>): string[] {
    const dto = plainToInstance(ContainerActionDto, value);
    return validateSync(dto, { whitelist: true }).map((e) => e.property);
  }

  test('принимает только restart', () => {
    expect(invalidAction({ action: 'restart' })).toEqual([]);
    for (const bad of ['stop', 'start', 'recreate', 'kill', '', 1, null]) {
      expect(invalidAction({ action: bad })).toContain('action');
    }
  });

  test('без action — тоже 400 (поле обязательное)', () => {
    expect(invalidAction({})).toContain('action');
  });
});
