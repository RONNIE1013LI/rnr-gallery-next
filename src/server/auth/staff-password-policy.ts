const common = new Set([
  "password1234", "password12345", "password123456", "123456789012", "1234567890123", "1234567890123456",
  "qwertyuiop12", "qwertyuiop123", "letmein123456", "welcome12345", "welcome123456", "admin12345678",
  "administrator", "changeme12345", "aaaaaaaaaaaa", "111111111111", "000000000000", "abcdefghijkl",
]);
export function validStaffPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 128 && !common.has(password.toLowerCase());
}
