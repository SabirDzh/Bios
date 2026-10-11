import { expect, test } from 'vitest';
import {
  agentStatus,
  containerState,
  DEPLOY_STEPS,
  deploymentStatus,
  deployStepLabel,
  serverStatus,
} from './statusMeta';

test('сервер: известные значения словаря', () => {
  expect(serverStatus('ONLINE')).toMatchObject({ tone: 'ok', label: 'онлайн', title: 'ONLINE' });
  expect(serverStatus('OFFLINE')).toMatchObject({ tone: 'neutral', label: 'офлайн' });
  expect(serverStatus('PENDING')).toMatchObject({ tone: 'info', label: 'ожидает проверки' });
});

test('неизвестное значение показывается как есть, нейтральным тоном', () => {
  expect(serverStatus('MAINTENANCE')).toMatchObject({
    tone: 'neutral',
    label: 'MAINTENANCE',
    title: 'MAINTENANCE',
  });
});

test('деплой: RUNNING вращает глиф, остальные — нет', () => {
  expect(deploymentStatus('RUNNING')).toMatchObject({ tone: 'info', label: 'выполняется' });
  expect(deploymentStatus('RUNNING').spin).toBe(true);
  expect(deploymentStatus('SUCCESS').spin).toBeUndefined();
  expect(deploymentStatus('FAILED')).toMatchObject({ tone: 'danger', label: 'ошибка' });
});

test('агент: устарел — предупреждение, сбой — опасность', () => {
  expect(agentStatus('ACTIVE')).toMatchObject({ tone: 'ok', label: 'активен' });
  expect(agentStatus('STALE')).toMatchObject({ tone: 'warn', label: 'устарел' });
  expect(agentStatus('FAILED')).toMatchObject({ tone: 'danger', label: 'сбой' });
  expect(agentStatus('NOT_INSTALLED')).toMatchObject({ tone: 'neutral' });
});

test('контейнер: Docker-значения и passthrough незнакомых', () => {
  expect(containerState('running')).toMatchObject({ tone: 'ok', label: 'работает' });
  expect(containerState('exited')).toMatchObject({ tone: 'neutral', label: 'остановлен' });
  expect(containerState('dead')).toMatchObject({ tone: 'danger', label: 'упал' });
  expect(containerState('weird-state')).toMatchObject({
    tone: 'neutral',
    label: 'weird-state',
  });
});

test('шаги деплоя: порядок конвейера и русские подписи', () => {
  expect(DEPLOY_STEPS).toEqual(['preflight', 'source', 'build', 'run']);
  expect(deployStepLabel('preflight')).toBe('Проверка');
  expect(deployStepLabel('run')).toBe('Запуск');
  // Незнакомый шаг — как есть, а не потерян.
  expect(deployStepLabel('deploy')).toBe('deploy');
  expect(deployStepLabel(null)).toBeNull();
});
