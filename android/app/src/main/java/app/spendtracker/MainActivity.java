package app.spendtracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsInboxPlugin.class);
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
