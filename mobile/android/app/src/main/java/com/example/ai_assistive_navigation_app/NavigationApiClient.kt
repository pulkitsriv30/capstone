package com.example.ai_assistive_navigation_app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.net.URLDecoder
import java.util.concurrent.TimeUnit
import org.json.JSONObject

data class NavigationResponse(
    val audioBytes: ByteArray?,
    val userQuery: String?,
    val textResponse: String?,
    val error: String?
)

class NavigationApiClient {
    // ADB reverse: localhost on phone -> laptop port 3000 via USB cable
    private val baseUrl = "http://localhost:3000/api/navigation"
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    fun searchObject(sessionId: String, audioFile: File, imageFile: File): NavigationResponse {
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("sessionId", sessionId)
            .addFormDataPart("audio", audioFile.name, audioFile.asRequestBody("audio/mp4".toMediaType()))
            .addFormDataPart("image", imageFile.name, imageFile.asRequestBody("image/jpeg".toMediaType()))
            .build()

        val request = Request.Builder()
            .url("$baseUrl/search")
            .post(requestBody)
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                val contentType = response.header("Content-Type") ?: ""
                if (contentType.contains("audio")) {
                    // Backend sent audio response
                    val query = response.header("X-User-Query")?.let { URLDecoder.decode(it, "UTF-8") }
                    val textResp = response.header("X-Response-Text")?.let { URLDecoder.decode(it, "UTF-8") }
                    NavigationResponse(response.body?.bytes(), query, textResp, null)
                } else {
                    // Backend sent JSON (TTS failed, but analysis succeeded)
                    val jsonStr = response.body?.string() ?: "{}"
                    val json = JSONObject(jsonStr)
                    val textResp = json.optString("textResponse", "")
                    val query = json.optString("userQuery", "")
                    NavigationResponse(null, query, textResp, null)
                }
            } else {
                val errorBody = response.body?.string() ?: "Unknown API Error"
                NavigationResponse(null, null, null, "HTTP ${response.code}: $errorBody")
            }
        } catch (e: Exception) {
            e.printStackTrace()
            NavigationResponse(null, null, null, "Network Error: ${e.message}")
        }
    }

    fun describeEnvironment(imageFile: File): NavigationResponse {
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("image", imageFile.name, imageFile.asRequestBody("image/jpeg".toMediaType()))
            .build()

        val request = Request.Builder()
            .url("$baseUrl/environment")
            .post(requestBody)
            .build()

        return try {
            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                val contentType = response.header("Content-Type") ?: ""
                if (contentType.contains("audio")) {
                    val textResp = response.header("X-Response-Text")?.let { URLDecoder.decode(it, "UTF-8") }
                    NavigationResponse(response.body?.bytes(), null, textResp, null)
                } else {
                    val jsonStr = response.body?.string() ?: "{}"
                    val json = JSONObject(jsonStr)
                    val textResp = json.optString("textResponse", "")
                    NavigationResponse(null, null, textResp, null)
                }
            } else {
                val errorBody = response.body?.string() ?: "Unknown API Error"
                NavigationResponse(null, null, null, "HTTP ${response.code}: $errorBody")
            }
        } catch (e: Exception) {
            e.printStackTrace()
            NavigationResponse(null, null, null, "Network Error: ${e.message}")
        }
    }
}
