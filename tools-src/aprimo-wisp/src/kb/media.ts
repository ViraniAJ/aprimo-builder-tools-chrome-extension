// Recordings made in Wisp are kept in the extension's IndexedDB ("media" store) and played by app/wisp/video.html.
import { openDB, reqP } from "./idb";

export async function putMedia(id: string, blob: Blob, meta: { title: string; mime: string }) {
  const db = await openDB();
  await reqP(db.transaction("media", "readwrite").objectStore("media").put({ id, blob, ...meta, at: Date.now() }));
}
export async function getMedia(id: string): Promise<{ id: string; blob: Blob; title: string; mime: string } | undefined> {
  const db = await openDB();
  return reqP(db.transaction("media").objectStore("media").get(id));
}
export async function deleteMedia(id: string) {
  const db = await openDB();
  await reqP(db.transaction("media", "readwrite").objectStore("media").delete(id));
}
