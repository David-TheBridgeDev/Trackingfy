package com.trackingfy.app;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationManager;
import android.location.altitude.AltitudeConverter;
import android.os.Build;
import android.os.SystemClock;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The two things about height that @capgo/background-geolocation leaves on the table.
 *
 * Android's GPS altitude is height above the WGS84 ellipsoid, not above sea level. The
 * two differ by the geoid undulation at that place, which across Europe is 40 to 55 m, so
 * every altitude the app showed was that much too high. Android 14 ships the geoid model
 * that converts one into the other, and this looks it up.
 *
 * Most mid and high-end phones also carry a barometer, which resolves changes in height
 * to a few centimeters where GNSS wanders by meters. Its samples are averaged here and
 * handed over about once a second, and the sensor hub is allowed to batch them, so the
 * processor and the web layer are woken no more often than the location updates already
 * wake them.
 */
@CapacitorPlugin(name = "Altimeter")
public class AltimeterPlugin extends Plugin {

    /** 5 Hz: enough to average out the sensor's noise within each second. */
    private static final int SAMPLING_PERIOD_US = 200_000;
    /** Lets the sensor hub hold samples for up to a second instead of waking the CPU each. */
    private static final int MAX_REPORT_LATENCY_US = 1_000_000;
    private static final long EMIT_INTERVAL_NS = 1_000_000_000L;

    private final ExecutorService geoidExecutor = Executors.newSingleThreadExecutor();

    private SensorManager sensorManager;
    private Sensor pressureSensor;
    private SensorEventListener pressureListener;

    private double pressureSum;
    private int pressureCount;
    private long windowStartNs;

    /** Created on first use, on the executor: it loads its model from disk. */
    private Object altitudeConverter;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        pressureSensor = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        unregisterPressure();
        geoidExecutor.shutdown();
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("barometer", pressureSensor != null);
        result.put("geoid", Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE);
        call.resolve(result);
    }

    /**
     * Height of the geoid above the WGS84 ellipsoid at a place, in meters: what has to be
     * subtracted from a GPS altitude to get the altitude above sea level. Null before
     * Android 14, which has no model to ask.
     */
    @PluginMethod
    public void getGeoidHeight(PluginCall call) {
        Double latitude = call.getDouble("latitude");
        Double longitude = call.getDouble("longitude");
        if (latitude == null || longitude == null) {
            call.reject("latitude and longitude are required");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            resolveGeoidHeight(call, null);
            return;
        }

        geoidExecutor.execute(() -> {
            try {
                resolveGeoidHeight(call, lookUpGeoidHeight(latitude, longitude));
            } catch (Exception e) {
                call.reject("Geoid lookup failed", e);
            }
        });
    }

    @RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private Double lookUpGeoidHeight(double latitude, double longitude) throws Exception {
        if (altitudeConverter == null) {
            altitudeConverter = new AltitudeConverter();
        }

        // A point on the ellipsoid itself: its height above sea level is minus the geoid's.
        Location location = new Location(LocationManager.GPS_PROVIDER);
        location.setLatitude(latitude);
        location.setLongitude(longitude);
        location.setAltitude(0);
        ((AltitudeConverter) altitudeConverter).addMslAltitudeToLocation(getContext(), location);

        return location.hasMslAltitude() ? -location.getMslAltitudeMeters() : null;
    }

    private void resolveGeoidHeight(PluginCall call, Double geoidHeight) {
        JSObject result = new JSObject();
        result.put("geoidHeight", geoidHeight == null ? JSONObject.NULL : geoidHeight);
        call.resolve(result);
    }

    @PluginMethod
    public void startBarometer(PluginCall call) {
        if (pressureSensor == null) {
            call.reject("This device has no barometer", "UNAVAILABLE");
            return;
        }

        if (pressureListener == null) {
            pressureSum = 0;
            pressureCount = 0;
            windowStartNs = 0;
            pressureListener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    onPressure(event.values[0], event.timestamp);
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {}
            };

            boolean registered = sensorManager.registerListener(
                pressureListener,
                pressureSensor,
                SAMPLING_PERIOD_US,
                MAX_REPORT_LATENCY_US
            );
            if (!registered) {
                pressureListener = null;
                call.reject("The barometer could not be started", "UNAVAILABLE");
                return;
            }
        }

        call.resolve();
    }

    @PluginMethod
    public void stopBarometer(PluginCall call) {
        unregisterPressure();
        call.resolve();
    }

    private void unregisterPressure() {
        if (sensorManager != null && pressureListener != null) {
            sensorManager.unregisterListener(pressureListener);
        }
        pressureListener = null;
    }

    /**
     * Average the samples of each second and pass the mean on. Timed by the samples' own
     * clock rather than by when they arrive, since batched samples arrive in bursts.
     */
    private void onPressure(float hPa, long timestampNs) {
        if (windowStartNs == 0) {
            windowStartNs = timestampNs;
        }

        pressureSum += hPa;
        pressureCount++;

        if (timestampNs - windowStartNs < EMIT_INTERVAL_NS) {
            return;
        }

        double mean = pressureSum / pressureCount;
        long ageMs = (SystemClock.elapsedRealtimeNanos() - timestampNs) / 1_000_000L;

        pressureSum = 0;
        pressureCount = 0;
        windowStartNs = timestampNs;

        JSObject sample = new JSObject();
        sample.put("pressure", mean);
        sample.put("time", System.currentTimeMillis() - Math.max(0, ageMs));
        try {
            notifyListeners("pressure", sample);
        } catch (Exception e) {
            Logger.error("Could not deliver a barometer sample", e);
        }
    }
}
