package app.spendtracker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * Voice input via the phone's own speech recognizer (Google voice typing on most phones).
 * Uses the system "speak now" screen, so the app itself never needs the microphone permission.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(r);
    }

    /** Options: language (default "en-IN"), prompt. Resolves { text }. */
    @PluginMethod
    public void listen(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-IN"))
            .putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Say the spend"))
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(call, intent, "onSpeechResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No speech recognizer on this phone", "UNAVAILABLE");
        }
    }

    @ActivityCallback
    private void onSpeechResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        ArrayList<String> matches = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (result.getResultCode() != Activity.RESULT_OK || matches == null || matches.isEmpty()) {
            call.reject("Cancelled", "CANCELLED");
            return;
        }
        JSObject r = new JSObject();
        r.put("text", matches.get(0));
        call.resolve(r);
    }
}
