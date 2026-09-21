import { captureUnit } from "../../src/engine/effects";
import { GameState } from "../../src/engine/types";

describe("captureUnit effect", () => {
  const initialState: GameState = {
    players: {
      playerA: {
        board: new Set(["unitA1", "unitA2"]),
        capturedUnits: new Set(),
        // other fields omitted for brevity
      } as any,
      playerB: {
        board: new Set(["unitB1", "unitB2"]),
        capturedUnits: new Set(),
        // other fields omitted for brevity
      } as any,
    },
    // other top‑level fields omitted
  } as any;

  it("moves a unit from opponent's board to captor's captured set", () => {
    const afterCapture = captureUnit(initialState, "playerA", "unitB1");

    // Captor's captured set now contains the target
    expect(afterCapture.players["playerA"].capturedUnits.has("unitB1")).toBe(
      true,
    );

    // Opponent no longer has the unit on their board
    expect(afterCapture.players["playerB"].board.has("unitB1")).toBe(false);

    // All other units remain untouched
    expect(afterCapture.players["playerA"].board).toEqual(
      new Set(["unitA1", "unitA2"]),
    );
    expect(afterCapture.players["playerB"].board).toEqual(
      new Set(["unitB2"]),
    );
  });

  it("throws if captor does not exist", () => {
    expect(() => captureUnit(initialState, "nonexistent", "unitB1")).toThrow(
      /Captor player/,
    );
  });

  it("throws if target is not on any opponent board", () => {
    expect(() => captureUnit(initialState, "playerA", "unitA1")).toThrow(
      /not on any opponent/,
    );
  });
});
