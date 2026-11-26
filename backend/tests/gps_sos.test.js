const test = require('node:test');
const assert = require('node:assert');
const gpsService = require('../src/services/gps.service');
const sosService = require('../src/services/sos.service');
const { ValidationError, NotFoundError } = require('../src/utils/errors');

test('GPS Service - Coordinate Tracking and Validation', () => {
  gpsService.clear();

  // Test missing deviceId
  assert.throws(
    () => {
      gpsService.updateLocation('', { latitude: 28.6, longitude: 77.2 });
    },
    (err) => err instanceof ValidationError
  );

  // Test invalid latitude (> 90)
  assert.throws(
    () => {
      gpsService.updateLocation('pi-test', { latitude: 95.0, longitude: 77.2 });
    },
    (err) => err instanceof ValidationError
  );

  // Test invalid longitude (< -180)
  assert.throws(
    () => {
      gpsService.updateLocation('pi-test', { latitude: 28.6, longitude: -190.0 });
    },
    (err) => err instanceof ValidationError
  );

  // Test valid update
  const record = gpsService.updateLocation('pi-test', {
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 5.2,
  });

  assert.strictEqual(record.latitude, 28.6139);
  assert.strictEqual(record.longitude, 77.209);
  assert.strictEqual(record.accuracy, 5.2);

  // Test retrieval
  const fetched = gpsService.getLocation('pi-test');
  assert.strictEqual(fetched.latitude, 28.6139);
  assert.strictEqual(fetched.longitude, 77.209);

  // Test unknown device returns null
  assert.strictEqual(gpsService.getLocation('unknown-device'), null);
});

test('SOS Service - Emergency Activation and AI Independence', () => {
  sosService.clear();
  gpsService.clear();

  // Ensure last known location is available
  gpsService.updateLocation('pi-user-1', {
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 4.0,
  });

  // 1. Activate SOS without inline location (should enrich from GPS service)
  const activation1 = sosService.activateSOS({
    deviceId: 'pi-user-1',
    trigger: 'voice_trigger',
    message: 'User requested emergency assistance',
  });

  assert.ok(activation1.sosId);
  assert.strictEqual(activation1.active, true);
  assert.strictEqual(activation1.alertsSent, 2);
  assert.strictEqual(activation1.isDuplicate, false);

  // 2. Verify alert record contains enriched GPS location
  const statusRecord = sosService.getSOSStatus(activation1.sosId);
  assert.strictEqual(statusRecord.active, true);
  assert.strictEqual(statusRecord.trigger, 'voice_trigger');
  assert.strictEqual(statusRecord.location.latitude, 28.6139);
  assert.strictEqual(statusRecord.location.isLastKnown, true);

  // 3. Debounce verification: triggering again immediately returns duplicate notice
  const activationDuplicate = sosService.activateSOS({
    deviceId: 'pi-user-1',
    trigger: 'button_spam',
  });

  assert.strictEqual(activationDuplicate.sosId, activation1.sosId);
  assert.strictEqual(activationDuplicate.isDuplicate, true);

  // 4. Deactivate SOS
  const deactivation = sosService.deactivateSOS(activation1.sosId, 'pi-user-1');
  assert.strictEqual(deactivation.active, false);
  assert.ok(deactivation.deactivatedAt);

  // Verify status reflects deactivation
  const statusAfterDeact = sosService.getSOSStatus(activation1.sosId);
  assert.strictEqual(statusAfterDeact.active, false);
});

test('SOS Service - Architectural Isolation Audit', () => {
  // Verify that SOS service does not import or depend on AI services
  const sosModuleContent = require('fs').readFileSync(
    require('path').resolve(__dirname, '../src/services/sos.service.js'),
    'utf-8'
  );

  assert.strictEqual(
    sosModuleContent.includes('vision.service'),
    false,
    'SOS must NOT import vision.service'
  );
  assert.strictEqual(
    sosModuleContent.includes('elevenlabs.service'),
    false,
    'SOS must NOT import elevenlabs.service'
  );
  assert.strictEqual(
    sosModuleContent.includes('ai-orchestrator'),
    false,
    'SOS must NOT import ai-orchestrator'
  );
  assert.strictEqual(
    sosModuleContent.includes('gemini'),
    false,
    'SOS must NOT import gemini'
  );
});
