package com.example.ai_assistive_navigation_app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

class CameraManager(private val context: Context) {
    private val imageCapture = ImageCapture.Builder()
        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
        .build()

    fun bindCamera(lifecycleOwner: LifecycleOwner) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    imageCapture
                )
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }, ContextCompat.getMainExecutor(context))
    }

    suspend fun captureFrame(): File = suspendCoroutine { continuation ->
        imageCapture.takePicture(
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    try {
                        val bitmap = image.toBitmap()
                        val rotatedBitmap = rotateBitmap(bitmap, image.imageInfo.rotationDegrees)
                        
                        // Scale down to max 800px width to prevent massive 5MB uploads (which cause HTTP 408 Timeouts)
                        val aspectRatio = rotatedBitmap.height.toFloat() / rotatedBitmap.width.toFloat()
                        val targetWidth = 800
                        val targetHeight = (targetWidth * aspectRatio).toInt()
                        val scaledBitmap = Bitmap.createScaledBitmap(rotatedBitmap, targetWidth, targetHeight, true)
                        
                        val compressedFile = File.createTempFile("frame", ".jpg", context.cacheDir)
                        val out = FileOutputStream(compressedFile)
                        scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 70, out)
                        out.close()
                        
                        image.close()
                        continuation.resume(compressedFile)
                    } catch (e: Exception) {
                        image.close()
                        continuation.resumeWithException(e)
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    continuation.resumeWithException(exception)
                }
            }
        )
    }

    private fun rotateBitmap(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
