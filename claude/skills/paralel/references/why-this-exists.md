# Why this exists (background)

Two ways of wasting money pull against each other here:

- **Running everything on the top model.** Moving a ticket's status, checking CI or renaming a file on Opus costs many times what Haiku would, for the same result.
- **Running hard work on a small model.** An auth change or a cross-service design done on Haiku comes back wrong. You pay for it again at a higher tier, plus the time it took to notice.

So each task is sized once, up front, with a written reason, and matched to the model that fits.

The branch model has a different reason. Nothing is tried out on `main`. A feature is assembled and tested on its own branch, several agents build its parts at once without sharing a working tree, and `main` only receives the finished, reviewed whole.

## Why lanes

One session working a 10-ticket epic serially takes a day. Ten sessions working it blindly collide on the lockfile, the same components and the same CI files, and spend the day resolving each other's conflicts. The gain is in the split: lanes cut along file boundaries and dependency order, each lane parallel inside itself through subagents, and a coordinator who sequences the few things that must be sequential (`lanes.md`).
