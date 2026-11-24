/**
 * Evaluation Runner — AI & Environmental Understanding Module
 * Author: Pulkit Srivastava
 *
 * Usage:
 *   node backend/evaluation/evaluate_vision.js
 *
 * Prerequisites:
 *   1. Backend .env configured with a valid GEMINI_API_KEY
 *   2. Test images placed in backend/evaluation/dataset/ using filenames from dataset_metadata.json
 *   3. Run from the project root: cd AI_Assistive_Navigation_App && node backend/evaluation/evaluate_vision.js
 *
 * Outputs:
 *   backend/evaluation/evaluation_results.json  — machine-readable per-image results
 *   Console table — human-readable summary
 */

require('dotenv').config({ path: './backend/.env' });

const fs   = require('fs');
const path = require('path');

const DATASET_META  = path.resolve(__dirname, 'dataset_metadata.json');
const DATASET_DIR   = path.resolve(__dirname, 'dataset');
const RESULTS_FILE  = path.resolve(__dirname, 'evaluation_results.json');

// ── Load dataset metadata ────────────────────────────────────────
const metadata = JSON.parse(fs.readFileSync(DATASET_META, 'utf8'));

// ── Load services ────────────────────────────────────────────────
// Adjust path relative to this file's location
const visionService = require('../src/services/vision.service');

// ── Helpers ──────────────────────────────────────────────────────

function computeObjectPrecision(detectedDescription, groundTruthObjects) {
  if (!detectedDescription || groundTruthObjects.length === 0) return null;
  const desc = detectedDescription.toLowerCase();
  const matched = groundTruthObjects.filter(obj => desc.includes(obj.toLowerCase()));
  return {
    matched: matched,
    matchCount: matched.length,
    totalGroundTruth: groundTruthObjects.length,
    recall: parseFloat((matched.length / groundTruthObjects.length).toFixed(2))
  };
}

function computeHazardRecall(detectedDescription, groundTruthHazards) {
  if (groundTruthHazards.length === 0) return { applicable: false };
  const desc = detectedDescription.toLowerCase();
  // Check for key hazard words
  const hazardKeywords = groundTruthHazards.flatMap(h => h.toLowerCase().split(' '));
  const uniqueKeywords = [...new Set(hazardKeywords)].filter(w => w.length > 3);
  const matched = uniqueKeywords.filter(kw => desc.includes(kw));
  return {
    applicable: true,
    hazardKeywordsFound: matched,
    hazardKeywordsMissed: uniqueKeywords.filter(w => !matched.includes(w)),
    recall: parseFloat((matched.length / Math.max(uniqueKeywords.length, 1)).toFixed(2))
  };
}

function assessEpistemicHonesty(description) {
  // Check if the model uses appropriate hedging language for uncertain claims
  const hedgeWords = ['appears', 'possibly', 'seems', 'might', 'may be', 'partially', 'unclear', 'hard to tell'];
  const found = hedgeWords.filter(w => description.toLowerCase().includes(w));
  return { hedgeWordsUsed: found };
}

function assessMetricDistanceClaim(description) {
  // Flag if model claimed specific metric distances (which it should NOT)
  const metricPattern = /\b\d+(\.\d+)?\s*(metre|meter|cm|centimetre|centimeter|foot|feet|inch|km)\b/i;
  return metricPattern.test(description);
}

// ── Main evaluation loop ─────────────────────────────────────────

async function runEvaluation() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   AI Navigation — Vision Evaluation Runner             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const results = [];
  let skipped = 0;

  for (const item of metadata) {
    const imagePath = path.join(DATASET_DIR, item.filename);

    if (!fs.existsSync(imagePath)) {
      console.warn(`⚠️  SKIPPED [${item.id}] — image file not found: ${item.filename}`);
      results.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        mode: item.mode,
        status: 'SKIPPED — image not found',
        latencyMs: null
      });
      skipped++;
      continue;
    }

    // Build a fake multer-style file object the service expects
    const fakeFile = {
      path: imagePath,
      mimetype: 'image/jpeg',
      originalname: item.filename
    };

    // Don't let the service delete our dataset images!
    // We patch _cleanupFile to do nothing during evaluation
    const originalCleanup = visionService._cleanupFile.bind(visionService);
    visionService._cleanupFile = () => {};  // no-op during eval

    let result = { id: item.id, filename: item.filename, category: item.category, mode: item.mode };

    try {
      const startMs = Date.now();

      let visionResult;
      // 60-second timeout per image — skips if Gemini is unresponsive
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout after 60s')), 60000)
      );

      if (item.mode === 'environment') {
        const tempPath = imagePath + '.tmp.jpg';
        fs.copyFileSync(imagePath, tempPath);
        fakeFile.path = tempPath;
        visionResult = await Promise.race([
          visionService.describeEnvironment(fakeFile),
          timeoutPromise
        ]);
      } else {
        const tempPath = imagePath + '.tmp.jpg';
        fs.copyFileSync(imagePath, tempPath);
        fakeFile.path = tempPath;
        visionResult = await Promise.race([
          visionService.analyzeImage(fakeFile, item.userQuery),
          timeoutPromise
        ]);
      }

      const latencyMs = Date.now() - startMs;
      const description = visionResult.description || '';

      // ── Metrics ──────────────────────────────────────────────
      const objectMetrics   = computeObjectPrecision(description, item.groundTruthObjects);
      const hazardMetrics   = computeHazardRecall(description, item.groundTruthHazards);
      const epistemicCheck  = assessEpistemicHonesty(description);
      const metricDistFlag  = assessMetricDistanceClaim(description);
      const wordCount       = description.split(/\s+/).filter(Boolean).length;
      const schemaValid     = typeof visionResult.found === 'boolean' &&
                              typeof visionResult.confidence === 'number' &&
                              typeof visionResult.description === 'string';

      // For object search: did found match expectation?
      let foundCorrect = null;
      if (item.mode === 'object_search' && 'expectedFound' in item) {
        foundCorrect = visionResult.found === item.expectedFound;
      }

      result = {
        ...result,
        status: 'OK',
        latencyMs,
        schemaValid,
        geminiFound: visionResult.found,
        geminiConfidence: visionResult.confidence,
        description,
        wordCount,
        objectRecall: objectMetrics,
        hazardRecall: hazardMetrics,
        epistemicHonesty: epistemicCheck,
        hallucination_flag: null,            // Set manually during review
        metric_distance_claimed: metricDistFlag,
        foundMatchedExpectation: foundCorrect,
        raw: visionResult
      };

      const icon = schemaValid ? '✅' : '⚠️ ';
      console.log(`${icon} [${item.id}] ${item.category} | ${latencyMs}ms | words:${wordCount} | recall:${objectMetrics?.recall ?? 'n/a'}`);
      if (metricDistFlag) console.log(`   🚨 METRIC DISTANCE CLAIMED — review for prompt compliance`);

    } catch (err) {
      result.status = `ERROR: ${err.message}`;
      result.latencyMs = null;
      console.error(`❌ [${item.id}] FAILED — ${err.message}`);
    } finally {
      // Restore cleanup function
      visionService._cleanupFile = originalCleanup;
    }

    results.push(result);

    // Brief pause between requests to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Summary Stats ─────────────────────────────────────────────
  const completed = results.filter(r => r.status === 'OK');
  const failed    = results.filter(r => r.status?.startsWith('ERROR'));
  const avgLatency = completed.length > 0
    ? Math.round(completed.reduce((s, r) => s + r.latencyMs, 0) / completed.length)
    : null;
  const schemaOk  = completed.filter(r => r.schemaValid).length;
  const metricFlags = completed.filter(r => r.metric_distance_claimed).length;
  const objectSearchResults = completed.filter(r => r.mode === 'object_search' && r.foundMatchedExpectation !== null);
  const objectSearchAccuracy = objectSearchResults.length > 0
    ? parseFloat((objectSearchResults.filter(r => r.foundMatchedExpectation).length / objectSearchResults.length).toFixed(2))
    : null;

  const summary = {
    runAt: new Date().toISOString(),
    totalImages: metadata.length,
    completed: completed.length,
    skipped,
    failed: failed.length,
    avgLatencyMs: avgLatency,
    schemaValidRate: `${schemaOk}/${completed.length}`,
    metricDistanceViolations: metricFlags,
    objectSearchFoundAccuracy: objectSearchAccuracy,
    results
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  EVALUATION SUMMARY');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Total images in dataset : ${metadata.length}`);
  console.log(`  Completed               : ${completed.length}`);
  console.log(`  Skipped (no image file) : ${skipped}`);
  console.log(`  Errors                  : ${failed.length}`);
  console.log(`  Avg response latency    : ${avgLatency ?? 'n/a'} ms`);
  console.log(`  Schema valid responses  : ${schemaOk}/${completed.length}`);
  console.log(`  Metric distance claimed : ${metricFlags} (should be 0)`);
  console.log(`  Object search accuracy  : ${objectSearchAccuracy !== null ? (objectSearchAccuracy * 100).toFixed(0) + '%' : 'n/a'}`);
  console.log(`\n  Results written to: ${RESULTS_FILE}`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log('  Next step: Open evaluation_results.json and manually review');
  console.log('  "hallucination_flag" field for each result that describes');
  console.log('  objects NOT present in the ground truth list.\n');
}

runEvaluation().catch(err => {
  console.error('Fatal evaluation error:', err);
  process.exit(1);
});
