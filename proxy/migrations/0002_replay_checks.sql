-- The latest replay check of each game, written by the bench (`--rows --collected`) and never by the
-- Worker, whose insert names its columns and leaves these at their defaults: a game arrives unchecked.
--
-- checked_on  the engine build (its commit id) the game was last replayed on; NULL until it is.
--             A build, not a time: the store records the UTC day a game arrived and nothing finer
-- refusal     why that replay did not reach the game's own result; NULL when it did
-- flagged     1 for a refusal of a game played on the build that checked it or the one before: a sign
--             of an engine defect rather than of the rules changing, so it is kept until looked at
ALTER TABLE collected_games ADD COLUMN checked_on TEXT;
ALTER TABLE collected_games ADD COLUMN refusal TEXT;
ALTER TABLE collected_games ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1));
