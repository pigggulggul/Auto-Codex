/** Local Atelier data, not a WS schema, AI response or execution authority. */
export type DecisionStatus = 'unknown' | 'proposed' | 'confirmed' | 'excluded';
export type Provenance = 'user' | 'example' | 'observation' | 'external';
export type Tab = 'design' | 'flow' | 'reference' | 'concept' | 'style' | 'brief' | 'prompt' | 'review';
export type Entry = 'idea' | 'image' | 'concept' | 'improve';
export type ProductType = '아직 미정' | '게임' | '제작 도구' | '판매 서비스' | '콘텐츠 서비스' | '브랜드' | '기타';
export type FieldKey = 'product' | 'user' | 'goal' | 'decisionMaker' | 'value' | 'doubt' | 'evidence' | 'environment' | 'scope' | 'fit' | 'constraints' | 'criteria';
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue | undefined;
};
export interface DomainContext {
    id(prefix: string): string;
    now(): string;
}
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface Links {
    dependsOn?: string[];
    screenIds?: string[];
    flowIds?: string[];
    assetIds?: string[];
    referenceIds?: string[];
    regionIds?: string[];
    appliesTo?: string[];
    scopeMode?: 'global' | 'targets';
    conceptId?: string | null;
    fontAssetId?: string | null;
}
export interface DecisionHistory extends Links {
    version?: number;
    value?: string;
    status?: DecisionStatus;
    source?: Provenance;
    scope?: string;
    reason?: string;
    at?: string;
    fileId?: string | null;
    cropId?: string | null;
    rect?: Rect;
    graph?: FlowGraph;
}
export interface Decision extends Links {
    easyManaged?: boolean;
    easyCustom?: boolean;
    easyPalette?: string | null;
    id: string;
    version: number;
    value: string;
    status: DecisionStatus;
    source: Provenance;
    reason: string;
    scope: string;
    reviewNeeded: boolean;
    history: DecisionHistory[];
    fileId?: string | null;
    cropId?: string | null;
    fileIds?: string[];
    rect?: Rect;
    graph?: FlowGraph;
    kind?: string;
    role?: string;
    priority?: string;
    purpose?: string;
    action?: string;
    info?: string;
    content?: string;
    conditions?: string;
    materialType?: string;
    availability?: string;
    method?: string;
    rules?: string;
    sourceUrl?: string;
    usage?: string;
    review?: string;
    exception?: string;
    selected?: boolean;
    summary?: string;
    experience?: string;
    hero?: string;
    bg?: string;
    text?: string;
    accent?: string;
    font?: string;
    shape?: string;
    layout?: string;
    material?: string;
    motion?: string;
    typography?: string;
    intensity?: string;
    resources?: string;
    reference?: string;
    assumptions?: string;
    label?: string;
    name?: string;
    observation?: string;
    interpretation?: string;
    dimension?: string;
    target?: string;
    keep?: string;
    change?: string;
    avoid?: string;
    useMode?: string;
}
export interface Feature extends Decision {
    flowIds: string[];
}
export interface Screen extends Decision {
    entry: string;
    response: string;
    next: string;
    exceptions: string;
    preserve: string;
    actions: string;
    links: string[];
}
export interface Flow extends Decision {
    goal: string;
    start: string;
    steps: string[];
    branch: string;
    recovery: string;
    complete: string;
    loop: boolean;
}
export interface Reference extends Links {
    id: string;
    name: string;
    url?: string;
    fileId: string | null;
    note?: string;
    role?: string;
    regions: Decision[];
    history?: DecisionHistory[];
}
export type DecisionNode = Decision | Reference;
export type TransitionKind = 'next' | 'branch' | 'recovery' | 'loop';
export type GraphPolicy = 'pending' | 'mapped' | 'none';
export interface Transition {
    id: string;
    from: string;
    to: string;
    kind: TransitionKind;
    condition: string;
    preserve: string;
}
export interface FlowGraph {
    version: number;
    reviewedVersion: number;
    entryId: string;
    terminalIds: string[];
    transitions: Transition[];
    branchPolicy: GraphPolicy;
    recoveryPolicy: GraphPolicy;
    branchReason: string;
    recoveryReason: string;
}
export interface OutputSelection {
    mode: 'all' | 'flows' | 'screens' | 'assets';
    ids: string[];
}
export interface Output {
    purpose: string;
    format: string;
    scope: string;
    selection: OutputSelection;
    tech: string;
    extra: string;
    common: string;
    commonVersion: number;
    procedure: string;
    procedureSource: string;
    language: string;
    version: number;
}
export interface Intent {
    at?: string;
    choice: string;
    reason?: string;
    revision: number;
}
export interface Criterion {
    id: string;
    label: string;
    expected: string;
    scope: 'visual' | 'behavior';
    decisionIds: string[];
}
export interface Section {
    id: string;
    title: string;
    body: string;
    decisionIds: string[];
    tab: Tab;
}
export interface ScopeContext {
    id: string;
    name: string;
    goal: string;
    path: string[];
    boundaries: (Transition & {
        fromName: string;
        toName: string;
    })[];
}
export type DeepReadonly<T> = T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
export interface SnapshotData {
    id: string;
    number: number;
    createdAt: string;
    revision: number;
    templateVersion: string;
    guideVersion: string;
    commonVersion: number;
    selection: OutputSelection;
    scopeContexts: ScopeContext[];
    decisions: {
        id: string;
        version: number;
    }[];
    referenceFileIds: string[];
    input: DesignInput;
    criteria: Criterion[];
    intent: Intent | null;
    output: Output;
    text: string;
    sections: Section[];
    draft: boolean;
    planId: string | null;
    baselineReason?: string;
}
export type PromptSnapshot = DeepReadonly<SnapshotData>;
export interface ManualResult {
    id: string;
    number?: number;
    snapshotId: string;
    fileId?: string | null;
    source?: string;
    screen: string;
    environment?: string;
    instruction?: string;
    execution?: string;
    note?: string;
    keep?: string;
}
export interface ReviewItem extends Criterion {
    verdict: 'match' | 'partial' | 'mismatch' | 'unverifiable' | 'na';
    observation: string;
    evidence: string;
    target: string;
    keep: string;
    cause: string;
    resolution: 'resolved' | 'remaining' | 'new-problem' | 'unverifiable';
    regression: boolean;
    selected: boolean;
}
export interface Recheck {
    decisionIds: string[];
    criterionIds: string[];
    reason: string;
    at: string;
}
export interface Review {
    id: string;
    resultId: string;
    snapshotId: string;
    parentReviewId: string | null;
    planId: string | null;
    createdAt: string;
    completedAt?: string;
    state: 'reviewing' | 'completed' | 'held' | 'needs-revision';
    scope: 'visual' | 'behavior';
    screen: string;
    intent: string;
    intentReason: string;
    holdReason: string;
    learning: string;
    externalFeedback: string;
    feedbackSource: string;
    items: ReviewItem[];
    recheck?: Recheck;
}
export interface PlanFields {
    problem?: string;
    cause?: string;
    target?: string;
    change: string;
    scope?: string;
    keep: string;
    materials?: string;
    check: string;
}
export interface RevisionPlan extends PlanFields {
    id: string;
    reviewId: string;
    resultId: string;
    snapshotId: string;
    selection: OutputSelection;
    itemIds: string[];
    createdAt: string;
    confirmed: boolean;
}
export interface Project {
    schemaVersion: 1;
    modelVersion?: number;
    id: string;
    name: string;
    idea: string;
    entry: Entry;
    type: ProductType;
    version: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
    fields: Record<FieldKey, Decision>;
    features: Feature[];
    contents: Decision[];
    flows: Flow[];
    screens: Screen[];
    references: Reference[];
    concepts: Decision[];
    styles: Decision[];
    assets: Decision[];
    snapshots: PromptSnapshot[];
    results: ManualResult[];
    reviews: Review[];
    plans: RevisionPlan[];
    activity: {
        at: string;
        reason: string;
        ids: string[];
        revision: number;
    }[];
    intent: Intent | null;
    handoff: {
        at?: string;
        waiting: boolean;
        snapshotId: string;
        revision?: boolean;
    } | null;
    progress: {
        tab: Tab;
        guideStage: number;
        returnTo: unknown;
        [key: string]: unknown;
    };
    output: Output;
    settings: {
        density: 'guide' | 'quick';
    };
    sampleKind?: string;
    scopeBasis?: Decision[];
    lastImpact?: {
        roots: string[];
        decisionIds: string[];
        reason: string;
        at: string;
    };
    restoredFrom?: string | { id: string; at: string };
}
export type DesignInput = Omit<Project, 'snapshots' | 'results' | 'reviews' | 'plans'> & {
    snapshots: [
    ];
    results: [
    ];
    reviews: [
    ];
    plans: [
    ];
};
export interface Issue {
    code: string;
    message: string;
    tab: Tab;
    id?: string;
    severity: 'blocking';
}
export interface Question {
    key: FieldKey;
    id: string;
    label: string;
    why: string;
    group: number;
    optional?: boolean;
}
export interface Palette {
    id?: string;
    name: string;
    label: string;
    bg: string;
    text: string;
    accent: string;
    font: string;
    shape: string;
    layout: string;
    material: string;
    motion: string;
}
export interface FlowExample {
    name: string;
    start: string;
    goal: string;
    steps: string[];
    roles: string[];
    branch: string;
    recovery: string;
    complete: string;
    loop: boolean;
}
export interface SnapshotOptions {
    draft?: boolean;
    plan?: RevisionPlan | null;
}
export interface NewProjectOptions {
    name: string;
    idea?: string;
    entry?: Entry;
    type?: ProductType;
}

