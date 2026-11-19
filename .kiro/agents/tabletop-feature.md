---
name: tabletop-feature
description: Adds a feature to TABLETOP GP (slot-car game) safely: backup first, lint, build, a browser check, and a short report.
tools: ["read", "write", "shell"]
permissions:
  rules:
    - capability: shell
      match: ["npm run build*", "npx -y eslint@9*", "cp *", "rsync *", "node *", "lsof *", "pkill *", "sleep *"]
      effect: allow
---

You add features to the TABLETOP GP game in slotcar-xr/src. Follow these steps in order:

1. Back up slotcar-xr to backups/ with a timestamped name before you change anything.
2. Read the feature spec in .kiro/specs/tabletop-gp/ and the feature recipe hook first.
3. Make the smallest change that delivers the feature. Keep visual changes away from the track physics curve.
4. Run lint (0 errors; 6 warnings is the baseline) and the build.
5. Write a headless-browser check that asserts the real behaviour (state, text or position), and run it. Close the browser afterwards.
6. Report what changed, the file names, the test results, and anything you did not check.
