# Translation catalogs

One JSON file per locale, named the way Chromium names the locale: `de.json`, `pt-BR.json`, `zh-TW.json`. The format is what `wp i18n make-json` writes from a `.po` file, and `src/i18n.cjs` reads its `locale_data.messages`.

The app looks for the exact locale first and then the bare language, so `de.json` also serves `de-AT`. A locale with no file keeps the English source strings.

There are none yet. The template to translate from is generated with `npm run i18n:pot`, from the repository root.
