import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CopyButton } from './CopyButton';

test('копирует значение и подтверждает', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(<CopyButton value="token-123" />);
  await userEvent.click(screen.getByRole('button'));
  expect(writeText).toHaveBeenCalledWith('token-123');
  expect(await screen.findByText('Скопировано')).toBeInTheDocument();
  vi.unstubAllGlobals();
});
