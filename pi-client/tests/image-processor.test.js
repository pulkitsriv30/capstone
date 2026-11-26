const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const imageProcessor = require('../src/processing/image.processor');
const { isValidJpegBuffer, MAX_UPLOAD_BYTES } = require('../src/processing/image.processor');
const { ImageValidationError } = require('../src/utils/errors');

test('ImageProcessor - Resizes Large PNG to <=800px JPEG Under 5MB', async () => {
  const rawPng = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 140, g: 160, b: 180 },
    },
  })
    .png()
    .toBuffer();

  const processed = await imageProcessor.processFrame(rawPng, { maxWidth: 800, quality: 75 });

  assert.strictEqual(processed.mimeType, 'image/jpeg');
  assert.strictEqual(processed.width, 800);
  assert.strictEqual(processed.height, 600);
  assert.ok(isValidJpegBuffer(processed.buffer));
  assert.ok(processed.sizeBytes < MAX_UPLOAD_BYTES);
  assert.ok(processed.meanLuma > 100);
});

test('ImageProcessor - Does Not Upscale Smaller Images', async () => {
  const smallJpg = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  const processed = await imageProcessor.processFrame(smallJpg, { maxWidth: 800, quality: 75 });

  assert.strictEqual(processed.width, 400);
  assert.strictEqual(processed.height, 300);
});

test('ImageProcessor - Rejects Empty or Corrupt Buffers', async () => {
  await assert.rejects(
    () => imageProcessor.processFrame(Buffer.alloc(0)),
    (err) => err instanceof ImageValidationError
  );

  await assert.rejects(
    () => imageProcessor.processFrame(Buffer.from('not-a-valid-image-payload-at-all-repeated'.repeat(10))),
    (err) => err instanceof ImageValidationError
  );
});
