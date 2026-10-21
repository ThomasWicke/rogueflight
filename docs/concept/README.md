# Concept art pass (2026-10-21)

24 concept images across the game, generated with gpt-image through the Codex CLI on Thomas's ChatGPT plan.
Each image has its full prompt (shared style block + subject, size, reference images) in the `.txt` next to it.
Board with the takeaways: https://claude.ai/artifact/WZpMz2pq3DjUyvN8Zjwe3r

These are targets, not game assets: the game draws its art in code (art.js, world.js, decals.js), and we lift
ideas from here into it. Generator: one isolated `codex exec` per image from an empty folder, read-only sandbox,
`--ignore-user-config --ephemeral`, the itch cover (`store/itch/cover.png`) as the style reference.
