// Only the installed build includes the Capacitor plugins: tools/build.mjs leaves them out of the website, which keeps
// its browser APIs.
export const installed = typeof __MOBILE__ !== 'undefined' && __MOBILE__;

export async function connectAndroidBack() {
  const {Capacitor} = await import('@capacitor/core');
  if (Capacitor.getPlatform() !== 'android') return;
  const {App} = await import('@capacitor/app');
  await App.addListener('backButton', async ({canGoBack}) => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (dialog) dialog.close();
    else if (canGoBack) history.back();
    else await App.minimizeApp();
  });
}

export async function workshopStorage() {
  if (!installed) return globalThis.localStorage;
  const {Preferences} = await import('@capacitor/preferences');
  // A reset or a second tick must reach disk after earlier edits, including when the bridge is busy.
  let pending = Promise.resolve();
  function write(operation) {
    const result = pending.then(operation);
    pending = result.catch((error) => console.error(error));
    return result;
  }
  return {
    getItem: async (key) => (await Preferences.get({key})).value,
    setItem: (key, value) => write(() => Preferences.set({key, value})),
    removeItem: (key) => write(() => Preferences.remove({key})),
  };
}

export async function shareCard(card) {
  const {PdfGenerator} = await import('@capgo/capacitor-pdf-generator');
  const title = card.querySelector('h1')?.textContent || document.title;
  const fileName = title.replace(/[^\p{L}\p{N} -]/gu, ' ').trim().slice(0, 80) + '.pdf';
  const css = document.getElementById('card-style').textContent;
  const data = `<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8"><style>${css}</style></head><body>${card.outerHTML}</body></html>`;
  await PdfGenerator.fromData({data, type: 'share', fileName});
}
