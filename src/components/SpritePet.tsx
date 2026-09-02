import { useEffect, useMemo, useState } from "react";
import type { PetState } from "../../shared/protocol";
import {
  animationForPetState,
  type LoadedPet,
  type PetMotion,
} from "../lib/petCatalog";

type Props = {
  pet: LoadedPet | null;
  state: PetState;
  motion?: PetMotion;
  size?: number;
  className?: string;
  label?: string;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function SpritePet({ pet, state, motion = "stationary", size = 78, className = "", label }: Props) {
  const animation = useMemo(() => animationForPetState(state, motion), [motion, state]);
  const [frame, setFrame] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setFrame(0);
  }, [animation.row, animation.frames, pet?.id]);

  useEffect(() => {
    if (reducedMotion || animation.frames <= 1) return;
    const timeout = window.setTimeout(
      () => setFrame((current) => (current + 1) % animation.frames),
      animation.durations[frame] ?? 150,
    );
    return () => window.clearTimeout(timeout);
  }, [animation, frame, reducedMotion]);

  if (!pet) {
    return <span className={`sprite-pet sprite-pet-fallback ${className}`} style={{ width: size, height: size }} aria-label={label || "캐릭터"}>C</span>;
  }

  const x = (frame / (pet.columns - 1)) * 100;
  const y = (animation.row / (pet.rows - 1)) * 100;
  return (
    <span
      className={`sprite-pet ${className}`}
      aria-label={label || `${pet.displayName} ${state}`}
      role="img"
      style={{
        width: size,
        height: Math.round(size * (pet.cellHeight / pet.cellWidth)),
        backgroundImage: `url("${pet.spritesheetUrl}")`,
        backgroundSize: `${pet.columns * 100}% ${pet.rows * 100}%`,
        backgroundPosition: `${x}% ${y}%`,
      }}
    />
  );
}
