---
version: "0.1.2"
level: copilot
processes:
  design: pair
  implementation: copilot
  testing: copilot
  documentation: pair
  review: assist
---

This format is based on [AI-DECLARATION.md](https://ai-declaration.md/en/0.1.2).

## Notes

- Hubert Dungen designs the product and the UX, makes the technical decisions, reviews and tests every change and uses Grimório daily.
- An AI coding assistant (Claude Code) writes a large part of the implementation and tests under his direction, asking for approval along the way. The documentation is written together, with his own edits.
- No AI-generated art ships with Grimório. Card images and text come from Scryfall. The optional "alter art" feature lets each user generate their own art with their own AI key.
