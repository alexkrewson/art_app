package com.alexkrewson.slowframe;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Lets the user hand SlowFrame a folder of their own photos on Android.
 *
 * The web build does this with showDirectoryPicker(), which does not exist in
 * Chrome on Android and therefore does not exist in our WebView either — the
 * "Choose folder…" button was inert on every tablet. Android's equivalent is
 * the Storage Access Framework: ACTION_OPEN_DOCUMENT_TREE returns a tree URI,
 * and takePersistableUriPermission() makes that grant survive a reboot, which
 * matters for a device that is meant to be set up once and left alone.
 *
 * The picked folder is walked recursively — a photos folder almost always has
 * subfolders, and requiring one pick per subfolder would be a poor trade on a
 * device you set up once.
 *
 * Deliberately no READ_EXTERNAL_STORAGE / READ_MEDIA_IMAGES in the manifest:
 * SAF grants access to exactly the one folder the user picked, so the app
 * never has to ask for the whole gallery.
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    private static final String DIR_MIME = DocumentsContract.Document.MIME_TYPE_DIR;

    /**
     * Subfolders are walked, because "my folder full of pictures" nearly always
     * has some. Two guards, both of which exist to stop one bad tree taking the
     * frame down rather than to ration normal use:
     *
     * MAX_DEPTH  — a provider is free to report a folder as its own descendant,
     *              and a few sync clients genuinely do. The visited-set below
     *              catches the simple case; this catches the rest.
     * MAX_IMAGES — the walk happens on every playlist rebuild, so it has to
     *              have a worst case. Ten thousand is far past any wall display
     *              and still finishes in well under a second.
     */
    private static final int MAX_DEPTH = 8;
    private static final int MAX_IMAGES = 10000;

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            // Backing out of the picker is an ordinary thing to do, not a
            // failure — the JS side matches on this code and stays quiet.
            call.reject("Folder selection cancelled", "CANCELLED");
            return;
        }

        Uri treeUri = data.getData();
        try {
            // Without this the grant dies with the Activity, and the frame
            // would come back from a reboot showing nothing.
            getContext()
                .getContentResolver()
                .takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Could not hold on to permission for that folder", "NO_PERSIST", e);
            return;
        }

        try {
            call.resolve(listImagesIn(treeUri));
        } catch (Exception e) {
            call.reject("Could not read that folder", "UNREADABLE", e);
        }
    }

    /**
     * Re-read a folder picked in an earlier session. Called on every playlist
     * rebuild rather than cached, so photos added to the folder after setup
     * appear on their own — for a picture frame that is the point.
     */
    @PluginMethod
    public void listImages(PluginCall call) {
        String uriString = call.getString("treeUri");
        if (uriString == null || uriString.isEmpty()) {
            call.reject("No folder has been picked", "NO_FOLDER");
            return;
        }

        try {
            call.resolve(listImagesIn(Uri.parse(uriString)));
        } catch (SecurityException e) {
            // The user revoked access, or the SD card holding it is gone. JS
            // treats this as "forget the folder" rather than an error to show.
            call.reject("Lost access to that folder", "ACCESS_LOST", e);
        } catch (Exception e) {
            call.reject("Could not read that folder", "UNREADABLE", e);
        }
    }

    private JSObject listImagesIn(Uri treeUri) {
        String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);

        List<Image> found = new ArrayList<>();
        Deque<Folder> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        queue.add(new Folder(treeDocId, "", 0));
        visited.add(treeDocId);

        boolean truncated = false;

        while (!queue.isEmpty() && !truncated) {
            Folder folder = queue.removeFirst();
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folder.docId);

            String[] columns = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            };

            // One unreadable subfolder shouldn't cost us the whole tree — an
            // empty SD-card mount point in the middle of Pictures is enough to
            // throw here, and the photos either side of it are still fine.
            try (Cursor cursor = getContext().getContentResolver().query(childrenUri, columns, null, null, null)) {
                while (cursor != null && cursor.moveToNext()) {
                    String docId = cursor.getString(0);
                    String rawName = cursor.getString(1);
                    String mime = cursor.getString(2);
                    String name = rawName == null ? docId : rawName;

                    if (DIR_MIME.equals(mime)) {
                        // visited also stops the same folder being walked twice
                        // when a provider exposes it under two parents.
                        if (folder.depth + 1 <= MAX_DEPTH && visited.add(docId)) {
                            queue.add(new Folder(docId, folder.path + name + "/", folder.depth + 1));
                        }
                        continue;
                    }

                    if (!isImage(name, mime)) continue;

                    found.add(
                        new Image(
                            name,
                            folder.path + name,
                            DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString()
                        )
                    );

                    if (found.size() >= MAX_IMAGES) {
                        truncated = true;
                        break;
                    }
                }
            } catch (SecurityException e) {
                // Only the picked root losing access means the grant itself is
                // gone — that propagates as ACCESS_LOST and the JS side forgets
                // the folder. A subfolder we may not read is just a branch to
                // skip; treating it as fatal would throw away a working folder
                // because of one directory inside it.
                if (folder.depth == 0) throw e;
            } catch (Exception ignored) {
                // Unreadable subfolder — skip it and keep walking.
            }
        }

        // Providers return children in no defined order, so without this the
        // sequential display mode would show a different order every reboot.
        Collections.sort(found, Comparator.comparing((Image image) -> image.path.toLowerCase(Locale.US)));

        JSArray images = new JSArray();
        for (Image image : found) {
            JSObject entry = new JSObject();
            entry.put("name", image.name);
            entry.put("path", image.path);
            entry.put("uri", image.uri);
            images.put(entry);
        }

        JSObject ret = new JSObject();
        ret.put("treeUri", treeUri.toString());
        ret.put("folderName", displayNameOf(treeUri, treeDocId));
        ret.put("images", images);
        ret.put("truncated", truncated);
        return ret;
    }

    private static final class Folder {

        final String docId;
        /** Path relative to the picked folder, e.g. "2024/Italy/" — "" at the root. */
        final String path;
        final int depth;

        Folder(String docId, String path, int depth) {
            this.docId = docId;
            this.path = path;
            this.depth = depth;
        }
    }

    private static final class Image {

        final String name;
        final String path;
        final String uri;

        Image(String name, String path, String uri) {
            this.name = name;
            this.path = path;
            this.uri = uri;
        }
    }

    /**
     * Trust the MIME type when the provider gives a real one, fall back to the
     * extension when it does not. Some providers — SD card and USB volumes in
     * particular — report application/octet-stream for perfectly ordinary
     * JPEGs, and on a tablet the removable card is exactly where the photos
     * tend to live.
     */
    private boolean isImage(String name, String mime) {
        if (DIR_MIME.equals(mime)) return false;
        if (mime != null && mime.startsWith("image/")) return true;
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.US);
        return lower.endsWith(".jpg")
            || lower.endsWith(".jpeg")
            || lower.endsWith(".png")
            || lower.endsWith(".webp")
            || lower.endsWith(".gif")
            || lower.endsWith(".avif");
    }

    /** The folder's own name, for the "Using: …" line in Settings. */
    private String displayNameOf(Uri treeUri, String treeDocId) {
        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
        String[] columns = { DocumentsContract.Document.COLUMN_DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(docUri, columns, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // A missing display name is cosmetic; fall through to the doc id.
        }
        return treeDocId;
    }
}
