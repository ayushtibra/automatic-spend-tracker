package app.spendtracker;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Receives SMS while the app is closed or open. Bank transaction alerts trigger a notification
 * ("tap to review") and, if the app is running, are pushed to the web layer immediately.
 * The message itself stays in the phone's SMS inbox; the app reads it from there on open.
 */
public class SmsReceiver extends BroadcastReceiver {

    static final String CHANNEL_ID = "bank_txns";

    private static final Pattern AMOUNT = Pattern.compile("(?i)(INR|Rs\\.?|₹)\\s*[\\d,]+");
    private static final Pattern TXN_WORD = Pattern.compile(
        "(?i)\\b(debited|spent|txn|used at|dr|paid|sent|withdrawn|purchase|charged|credited|refund(ed)?|revers(al|ed))\\b");
    private static final Pattern AMOUNT_VALUE = Pattern.compile("(?i)(INR|Rs\\.?|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern DEBIT_WORD = Pattern.compile("(?i)\\b(debited|spent|txn|used at|dr|paid|sent|withdrawn|purchase|charged)\\b");
    private static final Pattern CREDIT_WORD = Pattern.compile("(?i)\\b(credited|refund(ed)?|revers(al|ed))\\b");
    private static final Pattern NOT_TXN = Pattern.compile("(?i)\\bOTP\\b|one time password|will be debited|is due\\b|due date|declined|\\bfailed\\b");

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null) return;

        // Long SMS arrive in several parts; join them per sender.
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        long date = System.currentTimeMillis();
        for (SmsMessage part : parts) {
            String from = part.getDisplayOriginatingAddress();
            if (!SmsInboxPlugin.isBusinessSender(from)) continue;
            bodies.computeIfAbsent(from, k -> new StringBuilder()).append(part.getMessageBody());
        }

        for (Map.Entry<String, StringBuilder> e : bodies.entrySet()) {
            String body = e.getValue().toString();
            if (!looksLikeTransaction(body)) continue;
            SmsInboxPlugin.deliver("live-" + date, e.getKey(), body, date);
            if (!SmsInboxPlugin.inForeground) notify(context, body);
        }
    }

    static boolean looksLikeTransaction(String body) {
        return AMOUNT.matcher(body).find() && TXN_WORD.matcher(body).find() && !NOT_TXN.matcher(body).find();
    }

    private void notify(Context context, String body) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Bank transactions", NotificationManager.IMPORTANCE_DEFAULT));
        }

        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("openInbox", true);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String preview = body.replaceAll("\\s+", " ").trim();
        Matcher amount = AMOUNT_VALUE.matcher(preview);
        boolean credit = CREDIT_WORD.matcher(preview).find() && !DEBIT_WORD.matcher(preview).find();
        String title = amount.find()
            ? "₹" + amount.group(2) + (credit ? " credited" : " spent") + " — tap to review"
            : "New bank transaction — tap to review";
        NotificationCompat.Builder n = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rupee)
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(preview))
            .setContentIntent(pi)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(context).notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), n.build());
        } catch (SecurityException ignored) {
            // Notification permission revoked between the check and the call.
        }
    }
}
