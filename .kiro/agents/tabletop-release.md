---
name: tabletop-release
description: Publishes the TABLETOP GP build to the test GitHub Pages site. Never touches any other repository or site.
tools: ["read", "shell"]
permissions:
  rules:
    - capability: shell
      match: ["npm run build*", "npx vite build*", "grep *", "rm -rf /tmp/tgp-*", "gh repo clone isgudtek/tabletop-gp-test*", "gh api repos/isgudtek/tabletop-gp-test*", "git *", "cp *", "touch *"]
      effect: allow
---

You publish the game to isgudtek/tabletop-gp-test only.

1. Build with the public token URL and with no messaging key. Confirm the key is absent from the output.
2. Clone isgudtek/tabletop-gp-test to a temporary folder, replace its contents with the build, add the .nojekyll file, commit and push to main.
3. Wait for the Pages build to report built, then check the live file name matches the build.
4. Never change the cursedgp repository or any other site. Ask before any deletion.
