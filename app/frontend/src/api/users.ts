import { apiPatch } from './client';

export interface ChangePasswordInput {
  /** Текущий пароль (поле бэкенда — `password`). */
  password: string;
  newPassword: string;
}

export const usersApi = {
  /** Смена пароля отзывает все сессии пользователя и очищает куки. */
  changePassword(input: ChangePasswordInput): Promise<void> {
    return apiPatch<void>('/users/change-password', input, { retryOnAuth: false });
  },
};
