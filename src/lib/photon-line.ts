const E164_PHONE = /^\+[1-9]\d{7,14}$/;

export function requirePhotonIMessageLine(value = process.env.PHOTON_IMESSAGE_LINE): string {
  const line = value?.trim();
  if (!line) throw new Error("PHOTON_IMESSAGE_LINE is required.");
  if (!E164_PHONE.test(line)) throw new Error("PHOTON_IMESSAGE_LINE must be an E.164 phone number.");
  return line;
}

export function isConfiguredPhotonIMessageLine(receivingLine: string | undefined, configuredLine: string): boolean {
  return receivingLine?.trim() === configuredLine;
}