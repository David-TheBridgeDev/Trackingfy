package com.trackingfy.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Receives a route file that another app handed to Trackingfy.
 *
 * Android delivers a shared file in two shapes and neither is covered by the standard
 * Capacitor plugins: ACTION_VIEW puts the URI in the intent data, which the App plugin
 * exposes as a bare string that the Filesystem plugin then cannot open because it only
 * resolves file:// paths; ACTION_SEND puts it in EXTRA_STREAM, which the App plugin never
 * looks at. So this plugin reads the stream itself through the ContentResolver, which
 * holds the temporary read permission the intent granted, and hands the JavaScript side
 * the text rather than a URI it has no way to resolve.
 */
@CapacitorPlugin(name = "RouteImport")
public class RouteImportPlugin extends Plugin {

    /** A route of a few thousand points is far under a megabyte; beyond this it is not ours. */
    private static final int MAX_BYTES = 8 * 1024 * 1024;

    private String pendingRoute;

    @Override
    public void load() {
        // Cold start: the file itself launched the app, so the route is already waiting
        // in the intent before any JavaScript has had a chance to subscribe.
        readIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);

        if (readIntent(intent)) {
            JSObject payload = new JSObject();
            payload.put("data", pendingRoute);
            pendingRoute = null;
            notifyListeners("routeReceived", payload);
        }
    }

    /**
     * Hand over a route that arrived before the web layer was listening.
     *
     * Resolves with an empty object when there is nothing waiting, so the caller can run
     * this unconditionally at start-up.
     */
    @PluginMethod
    public void consumePendingRoute(PluginCall call) {
        JSObject result = new JSObject();

        if (pendingRoute != null) {
            result.put("data", pendingRoute);
            pendingRoute = null;
        }

        call.resolve(result);
    }

    @SuppressWarnings("deprecation")
    private boolean readIntent(Intent intent) {
        if (intent == null) {
            return false;
        }

        String action = intent.getAction();
        Uri uri = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }

        if (uri == null) {
            return false;
        }

        String content = readUri(uri);

        // Strip the payload out of the intent. The activity keeps its launch intent, and
        // without this a rotation or any other recreation would import the same file
        // again on the way back up.
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);
        intent.setAction(Intent.ACTION_MAIN);

        if (content == null) {
            return false;
        }

        pendingRoute = content;
        return true;
    }

    private String readUri(Uri uri) {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) {
                return null;
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;

            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    Logger.warn("RouteImport", "Shared file is too large to be a route");
                    return null;
                }
                out.write(buffer, 0, read);
            }

            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            Logger.error("RouteImport", "Could not read the shared file", e);
            return null;
        }
    }
}
