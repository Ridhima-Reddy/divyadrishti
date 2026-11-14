// Hub edits to the referral rules: the optometrists can change tier, time to
// care and action, or switch a rule off; an emergency rule cannot be switched off.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, setRuleOverrides, effectiveRules, ruleOverrides, emergencyFromAnswers } from '../../web/js/engine/redflags.js';
import { buildProfile, RULES_VERSION } from '../../web/js/engine/profile.js';

const base = { age: 55, rf_vision_drop: false, rf_flashes: false, rf_double: false, rf_red: false, rf_injury: false };
const floaters = { ...base, rf_flashes: true, rf_curtain: false };
const curtain = { ...base, rf_flashes: true, rf_curtain: true };
const edit = (rules) => setRuleOverrides({ version: 3, rules });

afterEach(() => setRuleOverrides(null));

test('no edits: built-in tiers apply', () => {
  assert.equal(ruleOverrides().version, 0);
  assert.equal(evaluate(floaters).flags[0].tier, 'urgent');
});

test('tier, time to care and action can be changed; the flag is marked edited', () => {
  edit({ FLASHES_FLOATERS: { tier: 'soon', within: 'within 1 week', action: 'Dilated exam at the vision centre this week.', reason: 'hub meeting', by: 'Optom. X' } });
  const f = evaluate(floaters).flags[0];
  assert.equal(f.tier, 'soon');
  assert.equal(f.within, 'within 1 week');
  assert.match(f.action, /this week/);
  assert.equal(f.edited, true);
  assert.equal(evaluate(floaters).lane, 'amber');
});

test('a tier change without new wording takes the tier’s default time', () => {
  edit({ FLASHES_FLOATERS: { tier: 'routine', reason: 'test' } });
  const f = evaluate(floaters).flags[0];
  assert.equal(f.tier, 'routine');
  assert.equal(evaluate(floaters).lane, 'green');
});

test('a rule switched off no longer fires', () => {
  edit({ FLASHES_FLOATERS: { off: true, reason: 'test' } });
  assert.equal(evaluate(floaters).flags.length, 0);
});

test('an emergency rule cannot be switched off', () => {
  edit({ RETINAL_DETACHMENT_SIGNS: { off: true, reason: 'test' } });
  const r = evaluate(curtain);
  assert.equal(r.flags[0].code, 'RETINAL_DETACHMENT_SIGNS');
  assert.equal(r.urgency, 'emergency');
  assert.equal(emergencyFromAnswers(curtain).length, 1, 'urgent mode still triggers');
});

test('unknown tiers and junk input are ignored', () => {
  edit({ FLASHES_FLOATERS: { tier: 'whenever', reason: 'x' } });
  assert.equal(evaluate(floaters).flags[0].tier, 'urgent');
  setRuleOverrides('junk');
  assert.equal(ruleOverrides().version, 0);
  assert.equal(effectiveRules().filter((r) => r.edited).length, 0);
});

test('the profile records which rule edits it ran under', () => {
  edit({ FLASHES_FLOATERS: { tier: 'soon', reason: 'x' } });
  assert.equal(buildProfile(floaters, {}).rulesVersion, `${RULES_VERSION}+hub.3`);
  setRuleOverrides(null);
  assert.equal(buildProfile(floaters, {}).rulesVersion, RULES_VERSION);
});
