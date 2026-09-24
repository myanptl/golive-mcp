export type Severity = "fail" | "warn" | "pass";

export interface Finding {
  check: string;
  severity: Severity;
  message: string;
  fix?: string;
}

const ICON: Record<Severity, string> = { fail: "✗", warn: "!", pass: "✓" };
const ORDER: Record<Severity, number> = { fail: 0, warn: 1, pass: 2 };

export function tally(findings: Finding[]) {
  return {
    fail: findings.filter((f) => f.severity === "fail").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    pass: findings.filter((f) => f.severity === "pass").length,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function verdict(findings: Finding[]): string {
  const t = tally(findings);
  if (t.fail > 0) return `Not ready: ${t.fail} blocking, ${t.warn} to look at, ${t.pass} fine.`;
  if (t.warn > 0) return `Ready, with ${plural(t.warn, "thing")} worth fixing. ${plural(t.pass, "check")} fine.`;
  return `Ready to go live. ${plural(t.pass, "check")} fine.`;
}

export function formatFindings(title: string, findings: Finding[], showPasses = true): string {
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const lines = [`## ${title}`, ""];
  for (const f of sorted) {
    if (f.severity === "pass" && !showPasses) continue;
    lines.push(`${ICON[f.severity]} **${f.check}**: ${f.message}`);
    if (f.fix && f.severity !== "pass") lines.push(`  Fix: ${f.fix}`);
  }
  return lines.join("\n");
}
