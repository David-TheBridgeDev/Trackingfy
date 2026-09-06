package com.trackingfy.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONObject;

/**
 * Owns what the user actually sees while an activity is being recorded.
 *
 * The recording itself runs in @capgo/background-geolocation's foreground service, and that
 * service anchors itself to a notification of its own: one static line of text, no controls,
 * posted once when the session starts and never touched again. Rather than fork the plugin,
 * this one posts over the very same notification id and channel. Android treats that as an
 * update of the existing notification, so the service stays foregrounded and legal while
 * everything on screen — live distance, the elapsed-time chronometer, the pause and finish
 * buttons, the Android 16 status bar chip — becomes ours to write.
 *
 * The two constants below are internal details of that plugin. They are the price of not
 * maintaining a fork, and they are the first thing to re-check when it is upgraded: if they
 * ever drift, this posts a second, separate notification instead of replacing the first.
 */
@CapacitorPlugin(
    name = "TrackingNotification",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class TrackingNotificationPlugin extends Plugin {

    /** BackgroundGeolocationService.NOTIFICATION_ID. */
    private static final int NOTIFICATION_ID = 28351;

    /** The channel capgo creates, named after its own package. */
    private static final String CHANNEL_ID = "com.capgo.capacitor_background_geolocation";

    private static final String ACTION_TAPPED = "com.trackingfy.app.TRACKING_NOTIFICATION_ACTION";
    private static final String EXTRA_ACTION_ID = "actionId";

    /**
     * The buttons arrive from the web layer as ids so their labels stay in the app's own
     * translation table, but the icons are Android resources and so are mapped here.
     */
    private final BroadcastReceiver actionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getStringExtra(EXTRA_ACTION_ID);
            if (action == null) {
                return;
            }

            JSObject payload = new JSObject();
            payload.put("action", action);
            // Retained: a button can be pressed while the WebView is paused in the
            // background, and the tap must not be dropped on the way.
            notifyListeners("trackingAction", payload, true);
        }
    };

    private Context receiverContext;

    @Override
    public void load() {
        receiverContext = getContext().getApplicationContext();
        ContextCompat.registerReceiver(
            receiverContext,
            actionReceiver,
            new IntentFilter(ACTION_TAPPED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();

        if (receiverContext == null) {
            return;
        }

        try {
            receiverContext.unregisterReceiver(actionReceiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered; nothing to undo.
        }
    }

    /**
     * Redraw the recording notification.
     *
     * Callers are expected to throttle: every call is a repost, and the elapsed time ticks
     * on its own once {@code ongoingSince} is set, so only a change in the text is worth one.
     */
    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);

        if (!manager.areNotificationsEnabled()) {
            // Recording is unaffected by this; there is simply nowhere to draw.
            call.resolve();
            return;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_trackingfy)
            .setContentTitle(call.getString("title", ""))
            .setContentText(call.getString("text", ""))
            .setOngoing(true)
            // Every repost would otherwise count as a fresh notification worth announcing.
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // Without this Android 12+ is allowed to sit on the notification for ten seconds
            // after the service starts, which reads as the recording not having begun.
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setShowWhen(false);

        applyAccentColour(context, builder);
        applyChronometer(call, builder);
        applyPromotion(call, builder);
        applyActions(call, builder);

        PendingIntent launch = launchIntent(context);
        if (launch != null) {
            builder.setContentIntent(launch);
        }

        try {
            manager.notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            Logger.error("TrackingNotification", "Not allowed to post the recording notification", e);
        }

        call.resolve();
    }

    /** Shared with capgo through the string resource, so the two never disagree. */
    private void applyAccentColour(Context context, NotificationCompat.Builder builder) {
        try {
            builder.setColor(
                Color.parseColor(
                    context.getString(R.string.capacitor_background_geolocation_notification_color)
                )
            );
        } catch (Exception e) {
            Logger.error("TrackingNotification", "Could not parse the notification colour", e);
        }
    }

    /**
     * The system ticks the elapsed time for us from a start instant, which is why recording
     * does not have to repost once a second just to move a clock. A paused session sends no
     * start instant and puts its frozen time in the body text instead.
     */
    private void applyChronometer(PluginCall call, NotificationCompat.Builder builder) {
        Double ongoingSince = call.getDouble("ongoingSince");

        if (ongoingSince != null && ongoingSince > 0) {
            builder.setWhen((long) ongoingSince.doubleValue()).setShowWhen(true).setUsesChronometer(true);
        }
    }

    /**
     * Android 16 promotes an ongoing notification to a status bar chip and to the lock
     * screen. Older versions ignore both calls, so there is nothing to gate on the version.
     */
    private void applyPromotion(PluginCall call, NotificationCompat.Builder builder) {
        if (!Boolean.TRUE.equals(call.getBoolean("promoted", Boolean.FALSE))) {
            return;
        }

        builder.setRequestPromotedOngoing(true);

        String chipText = call.getString("chipText");
        if (chipText != null && !chipText.isEmpty()) {
            builder.setShortCriticalText(chipText);
        }
    }

    private void applyActions(PluginCall call, NotificationCompat.Builder builder) {
        JSArray actions = call.getArray("actions");
        if (actions == null) {
            return;
        }

        for (int i = 0; i < actions.length(); i++) {
            try {
                JSONObject action = actions.getJSONObject(i);
                String id = action.getString("id");
                builder.addAction(iconFor(id), action.getString("title"), actionIntent(id));
            } catch (Exception e) {
                Logger.error("TrackingNotification", "Skipping a malformed notification action", e);
            }
        }
    }

    private int iconFor(String actionId) {
        switch (actionId) {
            case "pause":
                return R.drawable.ic_notif_pause;
            case "resume":
                return R.drawable.ic_notif_resume;
            default:
                return R.drawable.ic_notif_stop;
        }
    }

    private PendingIntent actionIntent(String actionId) {
        Intent intent = new Intent(ACTION_TAPPED)
            .setPackage(getContext().getPackageName())
            .putExtra(EXTRA_ACTION_ID, actionId);

        return PendingIntent.getBroadcast(
            getContext(),
            actionId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** Tapping the body brings the running app forward rather than starting a second copy. */
    private PendingIntent launchIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());

        if (launch == null) {
            return null;
        }

        launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
