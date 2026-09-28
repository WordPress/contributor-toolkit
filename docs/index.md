---
layout: home

hero:
  name: WordPress Contributor Toolkit
  text: Contribute to WordPress Core or Gutenberg with zero prerequisites
  tagline: A desktop app that clones wordpress-develop or Gutenberg, builds it, runs it, and turns your changes into a patch or pull request — no Git, Node, npm, or Docker required.
  actions:
    # Secondary on purpose: the brand-coloured action on this page is the
    # Download button injected after this list (see .vitepress/theme/Layout.vue).
    - theme: alt
      text: Get started
      link: /guide/getting-started

features:
  - title: A full contribution environment in one click
    details: The app clones wordpress-develop or Gutenberg, installs dependencies, builds, and starts a dev server — the whole toolchain ships inside the app as JavaScript and WASM.
  - title: Made for Contributor Days
    details: Create your first site at home a day or two before the event. On Contributor Day, update it to download the recent changes instead of the full repository and all its dependencies.
    link: /guide/trunk-updates
    linkText: Update to latest trunk
  - title: From code change to contribution
    details: Link a Core Trac ticket or Gutenberg GitHub issue, try the work already proposed, and submit your own changes as a pull request or a patch for your mentor. Core sites can also attach a patch to Trac.
  - title: One site, as many work items as you like
    details: Each ticket or issue gets its own branch inside the site and keeps its own work. Moving between two work items takes seconds — no second clone and no reinstall.
---
