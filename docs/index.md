---
layout: home

hero:
  name: WordPress Contributor Toolkit
  text: Contribute to WordPress core with zero prerequisites
  tagline: A desktop app that clones wordpress-develop, builds it, runs it, and turns your changes into a patch or pull request — no Git, Node, npm, or Docker required.
  actions:
    # Secondary on purpose: the brand-coloured action on this page is the
    # Download button injected after this list (see .vitepress/theme/Layout.vue).
    - theme: alt
      text: Get started
      link: /guide/getting-started

features:
  - title: A full core environment in one click
    details: The app clones wordpress-develop, installs dependencies, builds, and starts a dev server — the whole toolchain ships inside the app as JavaScript and WASM.
  - title: Made for Contributor Days
    details: First-time contributors often spend a whole session fighting their local setup. The Toolkit removes that step so the day is spent contributing.
  - title: From code change to contribution
    details: Link a Trac ticket, apply an existing patch or PR, and submit your own changes as a pull request, a Trac attachment, or a patch for your mentor.
  - title: One site, as many tickets as you like
    details: Each ticket gets its own branch inside the site and keeps its own work. Moving between two tickets takes seconds — no second clone and no reinstall.
---
