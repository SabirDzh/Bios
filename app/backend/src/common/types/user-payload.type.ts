export interface JwtUserPayload {
  userId: string;
  username: string;
  email: string;
  /** familyId сессии из access-токена (claim `sid`). */
  sid: string;
}
