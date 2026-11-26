const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const AudioPlayer = require('../src/audio/audio.player');
const { AudioPlaybackError } = require('../src/utils/errors');

test('AudioPlayer - Plays MP3 Buffer via Platform Command and Cleans Temp File', async () => {
  const calls = [];
  let fileExistedDuringPlayback = false;
  let capturedFilePath = null;

  const player = new AudioPlayer({
    enabled: true,
    backend: 'auto',
    platform: 'linux',
    execFile: async (bin, args) => {
      calls.push({ bin, args });
      capturedFilePath = args[args.length - 1];
      fileExistedDuringPlayback = fs.existsSync(capturedFilePath);
      return { stdout: '', stderr: '' };
    },
  });

  await player.playAudio(Buffer.from('fake-mp3-data'));

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'mpg123');
  assert.strictEqual(fileExistedDuringPlayback, true);
  assert.strictEqual(fs.existsSync(capturedFilePath), false, 'Temp MP3 file should be deleted after playback');
});

test('AudioPlayer - Rejects Empty Audio Buffer', async () => {
  const player = new AudioPlayer({ enabled: true });
  await assert.rejects(
    () => player.playAudio(Buffer.alloc(0)),
    (err) => err instanceof AudioPlaybackError
  );
});

test('AudioPlayer - Falls Back to Local TTS on JSON Fallback or MP3 Failure', async () => {
  const calls = [];
  const player = new AudioPlayer({
    enabled: true,
    platform: 'win32',
    execFile: async (bin, args, opts) => {
      calls.push({ bin, args, env: opts && opts.env });
      if (bin === 'ffplay') {
        throw new Error('ffplay crash');
      }
      return { stdout: '', stderr: '' };
    },
  });

  // 1. JSON fallback (audioAvailable: false)
  await player.playNavigationResult({
    audioAvailable: false,
    audioBuffer: null,
    textResponse: 'Chair directly ahead.',
  });

  const ttsCall = calls.find((c) => c.bin === 'powershell' && c.env && c.env.CAPSTONE_TTS_TEXT);
  assert.ok(ttsCall, 'Should invoke PowerShell SpeechSynthesizer');
  assert.strictEqual(ttsCall.env.CAPSTONE_TTS_TEXT, 'Chair directly ahead.');

  // 2. MP3 playback failure falls back to local TTS
  calls.length = 0;
  const failingMp3Player = new AudioPlayer({
    enabled: true,
    backend: 'ffplay',
    platform: 'win32',
    execFile: async (bin, args, opts) => {
      calls.push({ bin, args, env: opts && opts.env });
      if (bin === 'ffplay') throw new Error('decoder failed');
      return { stdout: '', stderr: '' };
    },
  });

  await failingMp3Player.playNavigationResult({
    audioAvailable: true,
    audioBuffer: Buffer.from('corrupt-mp3'),
    textResponse: 'Fallback spoken text.',
  });

  assert.ok(calls.some((c) => c.bin === 'ffplay'));
  assert.ok(calls.some((c) => c.bin === 'powershell' && c.env && c.env.CAPSTONE_TTS_TEXT === 'Fallback spoken text.'));
});
