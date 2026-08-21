package com.example.ai_assistive_navigation_app

import android.content.Context
import android.media.MediaPlayer
import java.io.File
import java.io.FileOutputStream

class AudioPlayer(private val context: Context) {
    private var mediaPlayer: MediaPlayer? = null

    fun playAudio(audioBytes: ByteArray, onComplete: () -> Unit = {}) {
        stopAudio()

        try {
            // Write to a temporary file
            val tempAudioFile = File.createTempFile("response", ".mp3", context.cacheDir)
            FileOutputStream(tempAudioFile).use { it.write(audioBytes) }

            mediaPlayer = MediaPlayer().apply {
                setDataSource(tempAudioFile.absolutePath)
                setOnCompletionListener { 
                    it.release() 
                    onComplete()
                }
                prepare()
                start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            onComplete()
        }
    }

    fun stopAudio() {
        mediaPlayer?.let {
            if (it.isPlaying) {
                it.stop()
            }
            it.release()
        }
        mediaPlayer = null
    }
}
