import type { PetState } from "../../shared/protocol";
import type { CSSProperties } from "react";
import { CHARACTER_ASSETS, CHARACTER_SHEET_COLUMNS, CHARACTER_STATE_ROWS, characterStateRow } from "../world/pixelWorld";

type Props = {
  spriteIndex: number;
  state: PetState;
  size?: number;
  animated?: boolean;
  className?: string;
};

type CharacterStyle = CSSProperties & {
  "--character-width": string;
  "--character-height": string;
  "--character-row": number;
};

export function WorldCharacter({ spriteIndex, state, size = 50, animated = true, className = "" }: Props) {
  const height = size;
  const width = Math.round(size * 3 / 4);
  const row = characterStateRow(state, false);
  const url = CHARACTER_ASSETS[spriteIndex % CHARACTER_ASSETS.length];
  const style: CharacterStyle = {
    "--character-width": `${width}px`,
    "--character-height": `${height}px`,
    "--character-row": row,
    width,
    height,
    backgroundImage: `url(${url})`,
    backgroundSize: `${width * CHARACTER_SHEET_COLUMNS}px ${height * CHARACTER_STATE_ROWS}px`,
    backgroundPosition: `0 -${row * height}px`,
  };
  return <span className={`world-character ${animated ? "is-animated" : ""} ${className}`.trim()} style={style} aria-hidden="true" />;
}
