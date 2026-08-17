export type DealSignalStatus = "possible" | "likely" | "confirmed";

export type ClassifiedDealSignal = {
  status: DealSignalStatus;
  confidence: number;
  evidence: string;
} | null;

export type ParticipantDealReport = { reported_by: string; evidence: { reportedPriceCents?: unknown } };

export function matchingCounterpartyReport(reports: ParticipantDealReport[], reporterId: string, priceCents: number): ParticipantDealReport | null {
  return reports.find(report => report.reported_by !== reporterId && report.evidence?.reportedPriceCents === priceCents) || null;
}

export function classifyDealSignal(text: string): ClassifiedDealSignal {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const payment = /\b(?:payment (?:sent|received)|paid (?:you|him|her|them))\b/.test(normalized);
  const handoff = /\b(?:picked it up|sold it to|handed it over)\b/.test(normalized);
  if ((payment && handoff) || /\b(?:deal is done|we completed the deal)\b/.test(normalized)) {
    return { status: "possible", confidence: 0.7, evidence: text.trim() };
  }
  if (payment || handoff || /\b(?:i(?:'ll| will) take it|we have a deal|agreed|see you (?:at|around)|meet (?:me|you) at|pickup (?:at|around)|send (?:the )?(?:venmo|zelle))\b/.test(normalized)) {
    return { status: "possible", confidence: 0.55, evidence: text.trim() };
  }
  if (/\b(?:interested|how much|where are you|maybe|let me think)\b/.test(normalized)) return null;
  return null;
}