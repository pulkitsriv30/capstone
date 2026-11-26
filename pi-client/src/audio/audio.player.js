const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const env = require('../config/env');
const logger = require('../utils/logger');
const { AudioPlaybackError } = require('../utils/errors');

const execFileAsync = promisify(execFile);

class AudioPlayer {
  constructor(options = {}) {
    this.enabled = options.enabled ?? env.AUDIO_PLAYER_ENABLED;
    this.backend = options.backend || env.AUDIO_PLAYER_BACKEND;
    this.platform = options.platform || process.platform;
    this.execFile = options.execFile || execFileAsync;
  }

  /**
   * Plays an MP3 audio buffer (audio/mpeg) through the system speaker.
   * Automatically cleans up temporary audio files.
   */
  async playAudio(audioBuffer) {
    if (!this.enabled) {
      logger.info('Audio playback disabled via AUDIO_PLAYER_ENABLED=false');
      return;
    }

    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new AudioPlaybackError('Audio buffer is empty');
    }

    const tempMp3Path = path.join(os.tmpdir(), `capstone-tts-${crypto.randomUUID()}.mp3`);

    try {
      await fs.promises.writeFile(tempMp3Path, audioBuffer);
      await this._dispatchFilePlayback(tempMp3Path);
    } catch (error) {
      if (error instanceof AudioPlaybackError) throw error;
      throw new AudioPlaybackError(`Audio playback failed: ${error.message}`, error);
    } finally {
      if (fs.existsSync(tempMp3Path)) {
        await fs.promises.unlink(tempMp3Path).catch(() => {});
      }
    }
  }

  async _dispatchFilePlayback(filePath) {
    const selected = this.backend;

    if (selected === 'ffplay') {
      await this._runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath]);
      return;
    }
    if (selected === 'mpg123') {
      await this._runPlayer('mpg123', ['-q', filePath]);
      return;
    }
    if (selected === 'afplay') {
      await this._runPlayer('afplay', [filePath]);
      return;
    }
    if (selected === 'powershell') {
      await this._playWindowsMediaPlayer(filePath);
      return;
    }

    // Auto mode by platform
    if (this.platform === 'win32') {
      try {
        await this._runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath]);
      } catch (err) {
        if (err.code === 'ENOENT') {
          await this._playWindowsMediaPlayer(filePath);
        } else {
          throw err;
        }
      }
      return;
    }

    if (this.platform === 'darwin') {
      await this._runPlayer('afplay', [filePath]);
      return;
    }

    // Linux / Raspberry Pi: prefer mpg123, fall back to ffplay
    try {
      await this._runPlayer('mpg123', ['-q', filePath]);
    } catch (err) {
      if (err.code === 'ENOENT') {
        await this._runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath]);
      } else {
        throw err;
      }
    }
  }

  async _runPlayer(binary, args) {
    try {
      await this.execFile(binary, args, { timeout: 60000 });
    } catch (err) {
      const wrapped = new AudioPlaybackError(`${binary} failed: ${err.message}`, err);
      wrapped.code = err.code || 'AUDIO_PLAYBACK_ERROR';
      throw wrapped;
    }
  }

  async _playWindowsMediaPlayer(filePath) {
    // Use PresentationCore MediaPlayer so MP3 files work without ffplay (SoundPlayer only supports WAV)
    const psScript = [
      'Add-Type -AssemblyName PresentationCore;',
      '$player = New-Object System.Windows.Media.MediaPlayer;',
      '$uri = New-Object System.Uri($env:CAPSTONE_AUDIO_PATH);',
      '$player.Open($uri);',
      '$player.Play();',
      'Start-Sleep -Milliseconds 300;',
      'while ($player.NaturalDuration.HasTimeSpan -and $player.Position -lt $player.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 };',
      '$player.Close();',
    ].join(' ');

    await this.execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        timeout: 60000,
        env: { ...process.env, CAPSTONE_AUDIO_PATH: filePath },
      }
    );
  }

  /**
   * Local OS Text-to-Speech fallback when backend returns JSON (audioAvailable: false).
   */
  async speakText(text) {
    if (!this.enabled || !text || typeof text !== 'string' || !text.trim()) {
      return;
    }

    const cleanText = text.trim();

    try {
      if (this.platform === 'win32') {
        const psScript = [
          'Add-Type -AssemblyName System.Speech;',
          '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
          '$synth.Speak($env:CAPSTONE_TTS_TEXT);',
        ].join(' ');
        await this.execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', psScript],
          {
            timeout: 30000,
            env: { ...process.env, CAPSTONE_TTS_TEXT: cleanText },
          }
        );
        return;
      }

      if (this.platform === 'darwin') {
        await this.execFile('say', [cleanText], { timeout: 30000 });
        return;
      }

      // Linux / Raspberry Pi
      try {
        await this.execFile('espeak-ng', [cleanText], { timeout: 30000 });
      } catch (err) {
        if (err.code === 'ENOENT') {
          await this.execFile('espeak', [cleanText], { timeout: 30000 });
        } else {
          throw err;
        }
      }
    } catch (error) {
      logger.warn('Local TTS fallback failed', { error: error.message });
    }
  }

  /**
   * Plays server MP3 audio if available, otherwise falls back to local OS TTS.
   */
  async playNavigationResult(result) {
    if (!result) return;

    if (result.audioAvailable && Buffer.isBuffer(result.audioBuffer)) {
      try {
        await this.playAudio(result.audioBuffer);
        return;
      } catch (playbackErr) {
        logger.warn('MP3 playback failed, falling back to local TTS', { error: playbackErr.message });
      }
    }

    if (result.textResponse) {
      await this.speakText(result.textResponse);
    }
  }
}

module.exports = AudioPlayer;
