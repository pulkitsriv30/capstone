const test = require('node:test');
const assert = require('node:assert');
const navigationService = require('../src/services/navigation.service');

test('Navigation Service Decision Engine', (t) => {
  const sessionId = 'test-session';
  
  // Attempt 1: Not found
  const res1 = navigationService.decideNextAction(sessionId, {
    found: false,
    target: "keys",
    suggested_direction: "left"
  });
  
  assert.strictEqual(res1.status, 'searching');
  assert.strictEqual(res1.response, "I can't see your keys. Please turn left.");
  
  // Attempt 2: Still not found (no direction given, uses default)
  const res2 = navigationService.decideNextAction(sessionId, {
    found: false,
    target: "keys"
  });
  
  assert.strictEqual(res2.status, 'searching');
  assert.ok(res2.response.includes("keys"));
  
  // Fast forward to attempt 6
  navigationService.decideNextAction(sessionId, { found: false, target: "keys" });
  navigationService.decideNextAction(sessionId, { found: false, target: "keys" });
  navigationService.decideNextAction(sessionId, { found: false, target: "keys" });
  
  // Attempt 6 should hit the limit
  const res6 = navigationService.decideNextAction(sessionId, { found: false, target: "keys" });
  assert.strictEqual(res6.status, 'limit_reached');
  assert.ok(res6.response.includes("couldn't locate"));
  
  // Attempt 7 should reset (be attempt 1 again)
  const res7 = navigationService.decideNextAction(sessionId, { found: true, target: "keys", location: "on the table" });
  assert.strictEqual(res7.status, 'found');
  assert.strictEqual(res7.response, "Your keys is located on the table.");
});
