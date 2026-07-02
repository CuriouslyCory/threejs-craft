import type { Box3, Vec3 } from "~/game/player/aabb";

/** Player collision box: 0.6 wide x 1.8 tall x 0.6 deep. */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_DEPTH = 0.6;

/** Build the player's world-space AABB from its feet-center position. */
export function boxFromFeetPosition(
  position: Vec3,
  width: number,
  height: number,
  depth: number,
): Box3 {
  const halfW = width / 2;
  const halfD = depth / 2;
  return {
    min: { x: position.x - halfW, y: position.y, z: position.z - halfD },
    max: { x: position.x + halfW, y: position.y + height, z: position.z + halfD },
  };
}
