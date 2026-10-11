import { apiPatch } from './client';

export interface ChangePasswordInput {
  /** Текущий пароль (поле бэкенда — `password`). */
  password: string;
  newPassword: string;
}

export const usersApi = {
  /**
   * Смена пароля отзывает все сессии пользователя и очищает куки.
   * Ретрай после refresh разрешён: он случается только ДО исполнения (истёк
   * access-токен), а успешная смена возвращает 200, а не 401 — повтор
   * невозможен. Без него протухший access давал сырое «Unauthorized».
   */
  changePassword(input: ChangePasswordInput): Promise<void> {
    return apiPatch<void>('/users/change-password', input);
  },
};
