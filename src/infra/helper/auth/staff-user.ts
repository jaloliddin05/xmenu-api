/** Strips the password hash before a staff user leaves the API. */
export function toStaffUser<T extends { password?: unknown }>(user: T): Omit<T, 'password'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = user;
  return rest;
}
