package com.trackingfy.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before the bridge starts, so the plugin can read the intent
        // that launched the activity.
        registerPlugin(RouteImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
