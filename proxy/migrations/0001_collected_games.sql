-- The store of collected games (POST /records, records.js). One row a game.
--
-- game_key      the game's own key, made from its starting position and moves (`gameKey`)
-- received_day  the day the game arrived, in UTC, and nothing finer: no time of day is kept
-- release       the build that played it, copied out of the payload so the store can be counted
-- commit_id     by build without unpacking every game
-- payload       the validated record as JSON text, gzipped
--
-- WITHOUT ROWID: a rowid counts up as rows are written, which would keep the order games arrived in
-- within a day, a finer "when" than the day itself. Rows are ordered by their key alone.
CREATE TABLE collected_games (
  game_key     TEXT PRIMARY KEY CHECK (length(game_key) = 16 AND game_key NOT GLOB '*[^0-9a-f]*'),
  received_day TEXT NOT NULL CHECK (received_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  release      TEXT,
  commit_id    TEXT,
  payload      BLOB NOT NULL
) WITHOUT ROWID;
