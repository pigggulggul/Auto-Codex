import type { PetState, SkillInfo, SkillRole } from "../../shared/protocol";
import { roleLabel } from "../lib/characterCatalog";
import { CHARACTER_PRESENTATIONS, type CharacterId } from "../lib/characterCatalog";
import { PET_PRESENTATIONS, shortSkillName } from "../lib/petCatalog";

type Props = {
  state: PetState;
  skill: SkillInfo | null;
  role: SkillRole;
  characterId: CharacterId;
  bridgeConnected: boolean;
  appServerReady: boolean;
  latestDetail?: string;
};

export function PetStage({ state, skill, role, characterId, bridgeConnected, appServerReady, latestDetail }: Props) {
  const presentation = PET_PRESENTATIONS[state];
  const character = CHARACTER_PRESENTATIONS[characterId] ?? CHARACTER_PRESENTATIONS.coordinator;
  return (
    <section className={`pet-stage accent-${presentation.accent} character-${character.id}`} aria-live="polite">
      <div className="room-light room-light-one" />
      <div className="room-light room-light-two" />
      <div className="stage-grid" />

      <div className="pet-status-row">
        <span className={`live-dot ${appServerReady ? "is-online" : bridgeConnected ? "is-bridge" : ""}`} />
        <span>{!bridgeConnected ? "LOCAL BRIDGE OFFLINE" : appServerReady ? "LOCAL CODEX ONLINE" : state === "error" ? "CODEX UNAVAILABLE" : "CODEX STARTING"}</span>
      </div>

      <div className={`pet-wrap pet-${state}`} data-state={state}>
        <div className="pet-particles" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="pet-shadow" />
        <div className="pet-character" aria-label={`${character.label} ${presentation.label}`}>
          <div className="pet-ear pet-ear-left" />
          <div className="pet-ear pet-ear-right" />
          <div className="pet-body">
            <div className="pet-screen">
              <span className="pet-eye pet-eye-left" />
              <span className="pet-eye pet-eye-right" />
              <span className="pet-mouth" />
            </div>
            <div className="pet-core" />
          </div>
          <div className="pet-arm pet-arm-left" />
          <div className="pet-arm pet-arm-right" />
          <div className="pet-foot pet-foot-left" />
          <div className="pet-foot pet-foot-right" />
        </div>
      </div>

      <div className="pet-copy">
        <div className="pet-pills">
          <span className="character-pill">{character.label}</span>
          {skill ? <span className="skill-pill">{shortSkillName(skill.name)}</span> : <span className="skill-pill muted">{roleLabel(role)}</span>}
        </div>
        <h1>{presentation.label}</h1>
        <p>{latestDetail || presentation.verb}</p>
      </div>
    </section>
  );
}
