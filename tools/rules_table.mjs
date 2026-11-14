// Writes docs/REFERRAL_RULES.md from the rule table the app runs
// (web/js/engine/redflags.js), so the document can never drift from the code.
// Run: node tools/rules_table.mjs
import { writeFileSync } from 'node:fs';
import { RULES, TIERS, TIER_ORDER, REFS, NOT_FLAGGED } from '../web/js/engine/redflags.js';
import { RULES_VERSION } from '../web/js/engine/profile.js';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [];
lines.push('# Referral rules: what is a red flag, and what is not');
lines.push('');
lines.push(`Generated from \`web/js/engine/redflags.js\` (rules ${RULES_VERSION}) by \`node tools/rules_table.mjs\`. The app, the portal and this page show the same table.`);
lines.push('');
lines.push('**Principle:** only the findings in the Emergency table send a patient to hospital today. Every other finding gets the slowest time-to-care that is still safe, so long-standing floaters, slow blur, itchy eyes or a family history do not trigger a same-day referral. Each red-flag question asks about one symptom that is NEW or SUDDEN, and follow-up questions (when did it start, is there a curtain, does it go away with one eye covered, what kind of injury) decide the tier.');
lines.push('');
lines.push('| Tier | Time to care | Lane | Hub reviews within |');
lines.push('|---|---|---|---|');
for (const t of TIER_ORDER) lines.push(`| ${TIERS[t].label} | ${TIERS[t].within} | ${TIERS[t].lane} | ${TIERS[t].reviewHours} h |`);
lines.push('');
lines.push('Tiers follow the College of Optometrists referral categories (emergency / urgent / routine) and use NICE time limits where NICE sets one (wet AMD: 1 working day; absent red reflex: 2 weeks).');
for (const t of TIER_ORDER) {
  const rules = RULES.filter((r) => r.tier === t);
  if (!rules.length) continue;
  lines.push('');
  lines.push(`## ${TIERS[t].label}: ${TIERS[t].within}`);
  lines.push('');
  lines.push('| Finding | Scores when | Time to care | Action | Evidence |');
  lines.push('|---|---|---|---|---|');
  for (const r of rules) {
    const ev = [r.ref, r.also].filter(Boolean).map((k) => `[${k}](#ref-${k})`).join(', ');
    lines.push(`| **${cell(r.title)}** \`${r.code}\` | ${cell(r.criteria)} | ${cell(r.within)} | ${cell(r.action)} | ${ev} |`);
  }
}
lines.push('');
lines.push('## Not a red flag');
lines.push('');
lines.push('| Presentation | Why it is not flagged |');
lines.push('|---|---|');
for (const n of NOT_FLAGGED) lines.push(`| ${cell(n.what)} | ${cell(n.why)} |`);
lines.push('');
lines.push('## Fail-safes');
lines.push('');
lines.push('- If the patient says their sight dropped suddenly but the onset question is skipped, the final triage treats it as recent (emergency).');
lines.push('- A spoken "yes" to any red-flag question must be confirmed by a tap before it counts.');
lines.push('- An emergency finding shortens the interview to the essential questions; urgent and lower findings do not.');
lines.push('- The reviewing optometrist can always escalate or downgrade; every rule is a proposal to be agreed with them before the pilot.');
lines.push('');
lines.push('## References');
lines.push('');
for (const [k, r] of Object.entries(REFS)) lines.push(`- <a id="ref-${k}"></a>**${k}** (${r.kind}): ${r.cite}. ${r.url}`);
lines.push('');
writeFileSync(new URL('../docs/REFERRAL_RULES.md', import.meta.url), lines.join('\n'));
console.log(`docs/REFERRAL_RULES.md: ${RULES.length} rules, ${NOT_FLAGGED.length} not-flagged presentations`);
