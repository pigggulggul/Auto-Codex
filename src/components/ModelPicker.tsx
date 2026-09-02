import type { ModelInfo, ReasoningEffort } from "../../shared/protocol";

type Props = {
  models: ModelInfo[];
  selectedModel: string;
  selectedEffort: ReasoningEffort | "";
  errors: string[];
  disabled: boolean;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: ReasoningEffort | "") => void;
  onRefresh: () => void;
};

function modelTone(model: string): string {
  if (model.includes("sol")) return "가장 강한 코딩·복합 작업";
  if (model.includes("terra")) return "성능과 비용의 균형";
  if (model.includes("luna")) return "빠르고 효율적인 반복 작업";
  return "Codex App Server에서 제공한 모델";
}

export function ModelPicker({
  models,
  selectedModel,
  selectedEffort,
  errors,
  disabled,
  onModelChange,
  onEffortChange,
  onRefresh,
}: Props) {
  const selected = models.find((model) => model.model === selectedModel) ?? models[0];
  const efforts = selected?.supportedReasoningEfforts ?? [];
  return (
    <div className="control-section model-control">
      <div className="section-heading">
        <div><span className="eyebrow">02 · ENGINE</span><h2>Codex 모델</h2></div>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={disabled} title="모델 목록 새로고침">↻</button>
      </div>
      {models.length > 0 ? (
        <>
          <div className="model-grid" role="radiogroup" aria-label="Codex 모델 선택">
            {models.map((model) => (
              <button
                type="button"
                role="radio"
                aria-checked={selectedModel === model.model}
                className={`model-option ${selectedModel === model.model ? "selected" : ""}`}
                key={model.id}
                onClick={() => onModelChange(model.model)}
                disabled={disabled}
              >
                <span className="model-orb">{model.model.includes("luna") ? "☾" : model.model.includes("terra") ? "◉" : "☀"}</span>
                <span><strong>{model.displayName}</strong><small>{modelTone(model.model)}</small></span>
                {model.isDefault && <em>DEFAULT</em>}
              </button>
            ))}
          </div>
          <label className="effort-field">
            <span>REASONING EFFORT</span>
            <select
              value={selectedEffort}
              onChange={(event) => onEffortChange(event.target.value as ReasoningEffort | "")}
              disabled={disabled}
            >
              <option value="">App Server 기본값</option>
              {efforts.map((effort) => (
                <option key={effort.reasoningEffort} value={effort.reasoningEffort}>
                  {effort.reasoningEffort.toUpperCase()}{effort.description ? ` · ${effort.description}` : ""}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="model-empty">App Server의 모델 목록을 기다리는 중입니다.</div>
      )}
      {errors.length > 0 && <p className="inline-warning">{errors[0]}</p>}
    </div>
  );
}
