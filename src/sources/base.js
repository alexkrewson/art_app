// The shape every image source implements. JS has no interfaces, so this is
// documentation + the one thing that IS shared code: the record shape
// consumed by Slideshow.
//
// ImageSource = {
//   id: string,                 // stable key, used in settings.sources
//   label: string,               // shown in the Sources settings section
//   needsApiKey: boolean,
//   description: string,
//   listFilters(): Promise<FilterSpec[]> | FilterSpec[],
//   fetchBatch({ filters, count }): Promise<ImageRecord[]>,
// }
//
// FilterSpec = { key, label, type: 'text'|'number'|'select'|'checkbox',
//                options?: {value,label}[], default?, placeholder?,
//                sensitive? }
// `sensitive: true` (used for API-key fields) renders as a password input
// in the Sources settings panel instead of plain text.
//
// ImageRecord = { title, artist, date, department, image (a URL), source (source id) }

export function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
