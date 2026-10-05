# Translation catalogs

One JSON file per locale, written by `npm run i18n:download` from translate.wordpress.org's project `meta/contributor-toolkit`. Do not edit them by hand: the next download replaces them. See "Translatable strings" in CONTRIBUTING.md for when that runs.

Each file is named by translate.wordpress.org's locale slug, which is lowercase: `de.json`, `pt-br.json`, `zh-tw.json`. The format is the `jed1x` export, and `src/i18n.cjs` reads its `locale_data.messages`.

The app walks the operating system's languages in order and loads the first one with a file, trying the exact tag, then its language and region, then for a tag with a script that script's usual region, then the bare language. So `es-MX` loads `es-mx.json`, `de-AT` loads `de.json`, and `zh-Hans-US` (macOS adds the user's region) loads `zh-cn.json`. English before another language keeps the English source strings. A slug and the tag an operating system reports are matched through `Intl.getCanonicalLocales`, which covers the three-letter slugs (`bel` is `be`) and Filipino (`tl` is `fil`); Valencian's `ca-val` is the one entry kept by hand, in `src/i18n.cjs`. A `--lang` switch replaces the operating system's list. A locale with no file keeps the English source strings.
