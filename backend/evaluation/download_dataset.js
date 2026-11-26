/**
 * Dataset Image Downloader — Unsplash API
 * Author: Pulkit Srivastava
 *
 * Downloads all 30 evaluation dataset images automatically from Unsplash
 * using search queries matched to each dataset entry.
 *
 * Usage:
 *   1. Get a free Unsplash API key from https://unsplash.com/developers
 *   2. Run: node backend/evaluation/download_dataset.js YOUR_ACCESS_KEY
 *      OR set env var: UNSPLASH_ACCESS_KEY=your_key node backend/evaluation/download_dataset.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

// ── Config ───────────────────────────────────────────────────────
const ACCESS_KEY   = process.argv[2] || process.env.UNSPLASH_ACCESS_KEY;
const DATASET_DIR  = path.resolve(__dirname, 'dataset');
const METADATA_FILE = path.resolve(__dirname, 'dataset_metadata.json');
const UNSPLASH_API = 'https://api.unsplash.com';

if (!ACCESS_KEY) {
  console.error('\n❌  No Unsplash Access Key provided.');
  console.error('    Usage: node backend/evaluation/download_dataset.js YOUR_ACCESS_KEY\n');
  process.exit(1);
}

// ── Search query map — one query per image ID ────────────────────
const SEARCH_QUERIES = {
  img_001: 'office desk laptop computer workspace',
  img_002: 'living room sofa bookshelf interior',
  img_003: 'kitchen interior counter refrigerator',
  img_004: 'hallway corridor door interior',
  img_005: 'bedroom interior bed wardrobe',
  img_006: 'cluttered messy room boxes floor',
  img_007: 'messy desk cables books office',
  img_008: 'storage room boxes shelves cluttered',
  img_009: 'footpath sidewalk curb road outdoor',
  img_010: 'parking lot cars outdoor',
  img_011: 'courtyard garden outdoor open',
  img_012: 'building entrance steps door outdoor',
  img_013: 'busy street road traffic pedestrians',
  img_014: 'crowded market walkway people street',
  img_015: 'busy lobby reception people indoor',
  img_016: 'staircase steps going up interior',
  img_017: 'staircase steps going down interior',
  img_018: 'footpath curb road edge outdoor',
  img_019: 'power cable cord floor office',
  img_020: 'wet floor sign caution indoor',
  img_021: 'dark dim corridor hallway low light',
  img_022: 'bright window backlight silhouette room',
  img_023: 'dark room lamp light night interior',
  img_024: 'night street outdoor streetlight dark',
  img_025: 'water bottle desk table clear',
  img_026: 'empty desk table office books',
  img_027: 'bag backpack sofa couch',
  img_028: 'wooden chair dining table room',
  img_029: 'glasses spectacles table newspaper',
  img_030: 'smartphone phone nightstand table bedroom',
};

// ── Helpers ───────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function searchUnsplash(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `${UNSPLASH_API}/search/photos?query=${encodedQuery}&per_page=1&orientation=landscape`;
    const options = {
      hostname: 'api.unsplash.com',
      path: `/search/photos?query=${encodedQuery}&per_page=1&orientation=landscape`,
      headers: {
        'Authorization': `Client-ID ${ACCESS_KEY}`,
        'Accept-Version': 'v1'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(json.errors.join(', ')));
          if (!json.results || json.results.length === 0) return reject(new Error('No results found'));
          // Get the regular-size image URL (~1080px wide — good for testing)
          const imageUrl = json.results[0].urls.regular;
          resolve(imageUrl);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ── Main ─────────────────────────────────────────────────────────
async function downloadDataset() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Unsplash Dataset Downloader — AI Navigation Evaluation  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Ensure dataset directory exists
  if (!fs.existsSync(DATASET_DIR)) {
    fs.mkdirSync(DATASET_DIR, { recursive: true });
  }

  const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  let downloaded = 0;
  let skipped    = 0;
  let failed     = 0;

  for (const item of metadata) {
    const destPath = path.join(DATASET_DIR, item.filename);

    // Skip if already downloaded
    if (fs.existsSync(destPath)) {
      console.log(`⏭️  [${item.id}] Already exists — skipping: ${item.filename}`);
      skipped++;
      continue;
    }

    const query = SEARCH_QUERIES[item.id];
    if (!query) {
      console.warn(`⚠️  [${item.id}] No search query defined — skipping`);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`⬇️  [${item.id}] Searching: "${query}" ...`);
      const imageUrl = await searchUnsplash(query);
      await downloadFile(imageUrl, destPath);
      const sizeKb = Math.round(fs.statSync(destPath).size / 1024);
      console.log(` ✅ saved (${sizeKb} KB) → ${item.filename}`);
      downloaded++;
    } catch (err) {
      console.log(` ❌ FAILED — ${err.message}`);
      failed++;
    }

    // Unsplash free tier allows 50 requests/hour — 1.5s gap keeps us safe
    await sleep(1500);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  DOWNLOAD SUMMARY');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Downloaded : ${downloaded}`);
  console.log(`  Skipped    : ${skipped}`);
  console.log(`  Failed     : ${failed}`);
  console.log(`  Saved to   : ${DATASET_DIR}`);
  console.log('──────────────────────────────────────────────────────────');

  if (failed > 0) {
    console.log(`\n  ⚠️  ${failed} image(s) failed. Re-run the script to retry — it skips already-downloaded files.`);
  } else {
    console.log('\n  ✅ All images downloaded! Now run the evaluation:');
    console.log('     node backend/evaluation/evaluate_vision.js\n');
  }
}

downloadDataset().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
