package app.spendtracker;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Exposes bank SMS to the web app.
 *
 * Only messages from business senders (alphanumeric IDs like "AX-HDFCBK-S") are ever returned,
 * so personal conversations never reach the JavaScript side. Parsing happens in JS (src/lib/sms.ts).
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class SmsInboxPlugin extends Plugin {

    /** True while the app is on screen: new SMS then show up live, so no notification is needed. */
    static volatile boolean inForeground;

    /** Set while the app is running so the receiver can push new SMS straight to the UI. */
    private static SmsInboxPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnResume() {
        inForeground = true;
    }

    @Override
    protected void handleOnPause() {
        inForeground = false;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
    }

    /** Notification tapped while the app is already open. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent.getBooleanExtra("openInbox", false)) {
            intent.removeExtra("openInbox");
            notifyListeners("openInbox", new JSObject(), true);
        }
    }

    /** Whether the app was launched by tapping a "new spend" notification (consumed once). */
    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        Intent intent = getActivity().getIntent();
        boolean openInbox = intent != null && intent.getBooleanExtra("openInbox", false);
        if (openInbox) intent.removeExtra("openInbox");
        JSObject result = new JSObject();
        result.put("openInbox", openInbox);
        call.resolve(result);
    }

    /** Writes a text file (CSV / JSON backup) to cache and opens the Android share sheet. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String filename = call.getString("filename");
        String content = call.getString("content", "");
        String mime = call.getString("mime", "text/plain");
        if (filename == null || !filename.matches("[A-Za-z0-9._-]+")) {
            call.reject("Invalid filename");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Cannot create export folder");
            File file = new File(dir, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, filename)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, filename));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not share file: " + e.getMessage());
        }
    }

    /** Called by {@link SmsReceiver} for each incoming business SMS. */
    static void deliver(String id, String address, String body, long date) {
        SmsInboxPlugin plugin = instance;
        if (plugin == null) return;
        plugin.notifyListeners("smsReceived", toJs(id, address, body, date), true);
    }

    /** Business senders use alphanumeric headers; people use phone numbers. */
    static boolean isBusinessSender(String address) {
        return address != null && address.matches(".*[A-Za-z].*");
    }

    /**
     * Reads inbox messages received after {@code since} (epoch ms), oldest first.
     * Options: since (number, default 0), limit (number, default 500).
     */
    @PluginMethod
    public void readMessages(PluginCall call) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        }
        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 500);

        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        JSArray messages = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
            uri, projection, Telephony.Sms.DATE + " > ?", new String[] { String.valueOf(since) }, Telephony.Sms.DATE + " ASC")) {
            if (c != null) {
                while (c.moveToNext() && messages.length() < limit) {
                    String address = c.getString(1);
                    if (!isBusinessSender(address)) continue;
                    messages.put(toJs(c.getString(0), address, c.getString(2), c.getLong(3)));
                }
            }
        } catch (Exception e) {
            call.reject("Could not read SMS: " + e.getMessage());
            return;
        }
        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    private static JSObject toJs(String id, String address, String body, long date) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("address", address);
        o.put("body", body);
        o.put("date", date);
        return o;
    }
}
