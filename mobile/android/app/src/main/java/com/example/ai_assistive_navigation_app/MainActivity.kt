package com.example.ai_assistive_navigation_app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.speech.tts.TextToSpeech
import java.util.Locale
import java.util.UUID
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.input.pointer.pointerInteropFilter

class MainActivity : ComponentActivity(), TextToSpeech.OnInitListener {

    private lateinit var cameraManager: CameraManager
    private lateinit var audioRecorder: AudioRecorder
    private lateinit var audioPlayer: AudioPlayer
    private val apiClient = NavigationApiClient()
    private lateinit var textToSpeech: TextToSpeech

    private var currentSessionId = UUID.randomUUID().toString()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.CAMERA] == true &&
            permissions[Manifest.permission.RECORD_AUDIO] == true) {
            cameraManager.bindCamera(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        cameraManager = CameraManager(this)
        audioRecorder = AudioRecorder(this)
        audioPlayer = AudioPlayer(this)
        textToSpeech = TextToSpeech(this, this)

        checkAndRequestPermissions()

        setContent {
            MaterialTheme {
                NavigationAppScreen()
            }
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            textToSpeech.language = Locale.US
        }
    }

    private fun speakUiFeedback(text: String) {
        if (::textToSpeech.isInitialized) {
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, null)
        }
    }


    private fun checkAndRequestPermissions() {
        val hasCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val hasAudio = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        if (hasCamera && hasAudio) {
            cameraManager.bindCamera(this)
        } else {
            permissionLauncher.launch(
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            )
        }
    }

    @OptIn(ExperimentalComposeUiApi::class)
    @Composable
    fun NavigationAppScreen() {
        var isRecording by remember { mutableStateOf(false) }
        var isProcessing by remember { mutableStateOf(false) }
        var statusText by remember { mutableStateOf("Ready. Press and hold anywhere to ask a question, or tap 'Describe Environment'.") }
        var transcriptText by remember { mutableStateOf("") }
        var errorText by remember { mutableStateOf("") }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(if (isRecording) Color(0xFFD32F2F) else Color(0xFF121212))
                .pointerInteropFilter { motionEvent ->
                    when (motionEvent.action) {
                        MotionEvent.ACTION_DOWN -> {
                            if (!isProcessing) {
                                isRecording = true
                                statusText = "Listening..."
                                transcriptText = ""
                                errorText = ""
                                speakUiFeedback("Started listening")
                                audioRecorder.startRecording()
                            }
                        }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                            if (isRecording) {
                                isRecording = false
                                statusText = "Analyzing..."
                                speakUiFeedback("Stopped listening. Analyzing.")
                                val audioFile = audioRecorder.stopRecording()
                                if (audioFile != null) {
                                    isProcessing = true
                                    processObjectSearch(audioFile, { query, response ->
                                        transcriptText = "You asked: $query\n\nAI says: $response"
                                        statusText = "Ready"
                                        isProcessing = false
                                    }, { error ->
                                        errorText = "Error: $error"
                                        statusText = "Ready"
                                        speakUiFeedback("An error occurred")
                                        isProcessing = false
                                    })
                                }
                            }
                        }
                    }
                    true
                }
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = statusText,
                color = Color.White,
                fontSize = 24.sp,
                modifier = Modifier.padding(bottom = 24.dp)
            )
            
            if (transcriptText.isNotEmpty()) {
                Text(
                    text = transcriptText,
                    color = Color.Green,
                    fontSize = 18.sp,
                    modifier = Modifier.padding(bottom = 24.dp)
                )
            }

            if (errorText.isNotEmpty()) {
                Text(
                    text = errorText,
                    color = Color.Red,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(bottom = 24.dp)
                )
            }

            Button(
                onClick = {
                    if (!isProcessing) {
                        statusText = "Analyzing Environment..."
                        transcriptText = ""
                        errorText = ""
                        isProcessing = true
                        processEnvironmentDescription({ response ->
                            transcriptText = "AI says: $response"
                            statusText = "Ready"
                            isProcessing = false
                        }, { error ->
                            errorText = "Error: $error"
                            statusText = "Ready"
                            isProcessing = false
                        })
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp),
                enabled = !isProcessing && !isRecording
            ) {
                Text("Describe Environment", fontSize = 20.sp)
            }
        }
    }

    private fun processObjectSearch(
        audioFile: java.io.File, 
        onSuccess: (String, String) -> Unit,
        onError: (String) -> Unit
    ) {
        lifecycleScope.launch {
            try {
                val imageFile = cameraManager.captureFrame()
                val apiResponse = withContext(Dispatchers.IO) {
                    apiClient.searchObject(currentSessionId, audioFile, imageFile)
                }

                if (apiResponse.error != null) {
                    onError(apiResponse.error)
                } else {
                    val q = apiResponse.userQuery ?: "Unknown"
                    val r = apiResponse.textResponse ?: "No text"
                    onSuccess(q, r)
                    if (apiResponse.audioBytes != null) {
                        audioPlayer.playAudio(apiResponse.audioBytes) {}
                    } else {
                        // ElevenLabs TTS failed — use Android native TTS
                        speakUiFeedback(r)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                onError(e.message ?: "Exception occurred")
            }
        }
    }

    private fun processEnvironmentDescription(
        onSuccess: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        lifecycleScope.launch {
            try {
                val imageFile = cameraManager.captureFrame()
                val apiResponse = withContext(Dispatchers.IO) {
                    apiClient.describeEnvironment(imageFile)
                }

                if (apiResponse.error != null) {
                    onError(apiResponse.error)
                } else {
                    val r = apiResponse.textResponse ?: "No text"
                    onSuccess(r)
                    if (apiResponse.audioBytes != null) {
                        audioPlayer.playAudio(apiResponse.audioBytes) {}
                    } else {
                        speakUiFeedback(r)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                onError(e.message ?: "Exception occurred")
            }
        }
    }
}