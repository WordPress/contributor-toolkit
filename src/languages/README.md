# Translation catalogs

One JSON file per locale, written by `npm run i18n:download` from translate.wordpress.org's project `meta/contributor-toolkit`. Do not edit them by hand: the next download replaces them. See "Translatable strings" in CONTRIBUTING.md for when that runs.

Each file is named by translate.wordpress.org's locale slug, which is lowercase: `de.json`, `pt-br.json`, `zh-tw.json`. The format is the `jed1x` export, and `src/i18n.cjs` reads its `locale_data.messages`.

The app lowercases the operating system's locale, tries the exact slug and then the bare language, so `de.json` also serves `de-AT`. Filipino is the one name that differs: Chromium's `fil` is translate.wordpress.org's `tl`. A locale with no file keeps the English source strings.
