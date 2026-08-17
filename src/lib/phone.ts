const E164_PHONE = /^\+[1-9][0-9]{7,14}$/;

export function normalizeE164Phone(value: string): string | null {
  const phone = value.trim();
  if (!E164_PHONE.test(phone)) return null;
  return phone;
}

export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const phone = value.trim();
  if (!phone || !/^\+?[0-9().\-\s]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10 || !/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(national)) return null;
  return `+1${national}`;
}