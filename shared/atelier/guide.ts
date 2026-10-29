import type { Tab, Entry, ProductType, FieldKey, Question, Palette, FlowExample } from './types.js';
export const GUIDE_VERSION = 'guide-1.3.2';
export const TABS: [
    Tab,
    string,
    string,
    string,
    string,
    string
][] = [
    ['design', '프로젝트 설계', 'edit', '01', 'Define your idea', '무엇을, 누구를 위해 만들까요?'],
    ['flow', '사용자 흐름', 'flow', '02', 'Connect the experience', '시작부터 완성까지, 자연스럽게.'],
    ['reference', '레퍼런스 연구', 'image', '03', 'Look a little closer', '좋아하는 이유를 발견해 보세요.'],
    ['concept', '컨셉 탐색', 'concept', '04', 'Find your direction', '같은 생각, 서로 다른 표현.'],
    ['style', '스타일과 리소스', 'style', '05', 'Make it tangible', '방향을 구체적인 규칙으로.'],
    ['brief', '디자인 브리프', 'brief', '06', 'See the whole picture', '결정들이 하나의 이야기가 되도록.'],
    ['prompt', '프롬프트 스튜디오', 'prompt', '07', 'Ready to create', '생각을 전달할 준비.'],
    ['review', '자가 진단과 수정', 'review', '08', 'Refine with intention', '실제 결과에서, 한 걸음 더.']
];
export const ENTRIES: [
    Entry,
    string,
    string,
    Tab,
    string
][] = [
    ['idea', '아이디어부터', '만들고 싶은 것을 함께 정리해요.', 'design', '이 설명으로 제품 방향 정리하기'],
    ['image', '이미지부터', '좋아하는 이미지에서 방향을 찾아요.', 'reference', '이미지 보며 느낌 정리하기'],
    ['concept', '컨셉 확정', '이미 정한 방향을 표현 규칙으로 바꿔요.', 'concept', '이 컨셉을 표현 규칙으로 정리하기'],
    ['improve', '기존 결과 개선', '기준과 실제 결과의 차이를 살펴봐요.', 'review', '이 결과에서 어긋난 부분 찾기']
];
export const TYPES: ProductType[] = ['아직 미정', '게임', '제작 도구', '판매 서비스', '콘텐츠 서비스', '브랜드'];
export const QUESTIONS: Question[] = [
    { key: 'product', id: 'Q01', label: '무엇을 만드는 프로젝트인가요?', why: '한 문장이 기능과 화면의 중심을 잡아 줍니다.', group: 0 },
    { key: 'user', id: 'Q02', label: '누가, 어떤 상황에서 쓰나요?', why: '사용자의 상황에 맞춰 설명과 조작을 정합니다.', group: 0 },
    { key: 'goal', id: 'Q03', label: '이용 후 무엇이 남으면 만족할까요?', why: '기능 이름보다 사용자가 얻을 변화를 적어 보세요.', group: 0 },
    { key: 'decisionMaker', id: 'Q19', label: '누가 사용하거나 구매하기로 결정하나요?', why: '사용자와 비용을 내는 사람이 다를 수 있습니다. 구매가 없으면 사용 결정자를 적으세요.', group: 1 },
    { key: 'value', id: 'Q20', label: '구매하거나 제공받는 대상은 무엇인가요?', why: '실제 결과와 구매 대상을 구별하면 필요한 자료가 분명해집니다.', group: 1 },
    { key: 'doubt', id: 'Q06', label: '사용자는 무엇을 망설릴까요?', why: '조사로 확인한 사실인지, 확인할 가설인지도 적어 주세요.', group: 1 },
    { key: 'evidence', id: 'Q21', label: '처음 쓰는 사람이 막히지 않도록 어떤 안내나 기능을 넣을까요?', why: '앞에서 적은 걱정을 줄일 방법을 적으세요. 예: 실수가 걱정된다면 되돌리기 버튼. 실제 사용자 조사가 아니라면 가설로 표시합니다.', group: 2 },
    { key: 'environment', id: 'Q09', label: '어디서, 어떤 방식으로 사용하나요?', why: '기기·입력 방식·언어를 알아야 읽기와 조작을 확인할 수 있습니다.', group: 2 },
    { key: 'scope', id: 'Q07', label: '이번에 꼭 만들 범위는 어디까지인가요?', why: '계정·결제·공유는 필요하다고 확인했을 때만 포함합니다.', group: 2 },
    { key: 'fit', id: 'Q22', label: '선택한 화면 스타일이 사용자의 작업에 어떤 도움이 되나요?', why: '컨셉을 고른 다음 답하는 항목입니다. 예: 상태를 빠르게 읽어야 해서 숫자와 버튼이 또렷한 방향을 선택함.', group: 3 },
    { key: 'constraints', id: 'Q05', label: '반드시 지킬 사용 조건이 있나요?', why: '회원가입 없이 사용, 색만으로 상태를 구별하지 않기처럼 꼭 지킬 조건이 있을 때만 적으세요. 없어도 진행합니다.', group: 3, optional: true },
    { key: 'criteria', id: 'Q16', label: '완성된 화면과 동작에서 무엇을 확인할까요?', why: '이 프로젝트의 디자인 결과를 나중에 비교할 기준입니다. 예: 입력값 변경 후 결과가 보이는지, 잘못 입력해도 다시 고칠 수 있는지.', group: 3 }
];
const GENERIC: Record<FieldKey, string> = { product: '사용자가 필요한 정보를 모으고 비교해 작업을 완성하는 도구', user: '처음 사용하는 사람, 혼자 작업하는 상황', goal: '필요한 자료를 잃지 않고 자신의 결과물을 완성한다.', decisionMaker: '직접 사용하기로 결정하는 사용자. 구매 여부는 아직 미정.', value: '편집 가능한 작업 결과와 저장 파일', doubt: '가설: 실수하거나 이전으로 돌아가면 작업이 사라질까?', evidence: '실행 취소와 저장 안내 → 작업 화면 → 복구를 직접 실행해 확인. 실제 실행 근거는 아직 필요.', environment: '데스크톱과 모바일 웹, 키보드·마우스·터치, 한국어', scope: '핵심 작업과 저장·복구. 계정과 결제는 후속 검토.', fit: '조용한 배경과 분명한 선택 상태가 작업에 집중하도록 돕는다.', constraints: '실제 콘텐츠를 중심에 두고 장식이 조작을 가리지 않게 한다.', criteria: '주요 작업의 시작·완료·실패·복구에서 다음 행동을 이해할 수 있는지 실제 실행으로 확인한다.' };
export const SAMPLE_EXAMPLES: Record<Exclude<ProductType, '기타'>, Record<FieldKey, string>> = {
    '아직 미정': GENERIC,
    '제작 도구': { ...GENERIC, product: '사진 네 장을 꾸며 이미지로 저장하는 모바일 도구', user: '기억에 남는 사진을 자신의 분위기로 꾸며 간직하고 싶은 사람', goal: '마음에 드는 네 장을 꾸며 저장한다.', value: '직접 꾸민 네컷 사진 이미지', doubt: '가설: 사진을 교체하면 프레임과 꾸민 내용이 사라질까?', evidence: '편집 상태 유지와 실행 취소 → 선택·꾸미기 화면 → 사진 교체와 되돌리기를 직접 실행해 확인. 아직 구현 전.', scope: '촬영 또는 가져오기, 네 장 선택, 꾸미기, 완성 확인, 이미지 저장. 계정·유료·인쇄는 미정.', fit: '핑크빛 장식은 사진의 소장 가치를 더하고, 촬영·편집 도구는 읽기 쉽게 분리한다.', criteria: '사진이 주인공인지, 얼굴을 장식이 가리지 않는지, 교체·뒤로 가기에서 편집이 유지되는지 확인한다.' },
    '게임': { ...GENERIC, product: '탐험·채집·제작·건설이 연결되는 2D 픽셀 생존 게임', user: '탐험과 거점 건설을 즐기는 플레이어', goal: '새로운 세계를 발견하고 직접 만든 거점을 발전시킨다.', decisionMaker: '플레이를 선택하는 사용자. 과금과 구매 여부는 미정.', value: '자유로운 탐험과 발전하는 거점의 경험. 구매 대상은 해당 없음.', doubt: '가설: 다음에 무엇을 할 수 있고 어떤 재료가 부족할까?', evidence: '상호작용 표시와 부족한 재료 안내 → 월드·제작 패널 → 실제 플레이에서 행동을 발견하는지 확인. 구현 근거는 아직 필요.', environment: '데스크톱 2D 게임, 키보드와 마우스, 한국어', scope: '탐험·채집·제작·건설·저장과 중단 복구. 전투 강도·사망 손실·협동·과금은 미정.', fit: '차가운 숲과 따뜻한 거점의 대비로 탐험과 귀환을 구별하고 HUD는 명확하게 읽힌다.', constraints: '월드와 아이템에 픽셀 표현. 긴 한글 설명은 읽기 쉽게 분리.', criteria: '월드·HUD·인벤토리의 구분, 부족한 재료 안내, 반복 루프와 저장 복구를 실제 플레이로 확인한다.' },
    '판매 서비스': { ...GENERIC, product: '작업용 디지털 리소스를 비교하고 구매하는 판매 서비스', user: '자신의 제작 환경에 맞는 리소스를 찾는 제작자', value: '사용 조건이 명확한 실제 리소스 파일', decisionMaker: '리소스를 사용하는 제작자 또는 구매 담당자', doubt: '가설: 내 작업에 쓸 수 있을까? 규격과 라이선스는 맞을까?', evidence: '실제 파일 사양과 사용 조건 → 상품 상세 → 규격과 사용 범위를 찾을 수 있는지 확인. 자료 확보 필요.' },
    '콘텐츠 서비스': { ...GENERIC, product: '관심 있는 콘텐츠를 찾아 읽고 다시 모아 보는 서비스', goal: '필요한 내용을 이해하고 다음에 다시 찾는다.', value: '읽고 이해한 정보와 저장한 목록' },
    '브랜드': { ...GENERIC, product: '재질과 제작 과정을 통해 가치를 전달하는 브랜드 사이트', fit: '코튼을 부드러운 천의 결로 정의한다는 후보. 브랜드 자료와 맞는지 사용자가 확인한다.' }
};
export const EXAMPLES: Record<ProductType | '기타', Record<FieldKey, string>> = {
    '아직 미정': GENERIC,
    '기타': GENERIC,
    '제작 도구': { ...GENERIC, product: '원하는 값을 입력하고 작업 결과를 확인하는 도구', user: '작업 대상과 상태를 확인하며 도구를 사용하는 사람', goal: '입력한 내용이 결과에 어떻게 반영되는지 확인한다.', value: '직접 확인하고 활용할 수 있는 작업 결과', scope: '핵심 입력·상태 확인·결과 확인. 계정과 결제는 필요할 때만 검토.', fit: '핵심 정보와 조작 버튼을 구분해 작업 중 실수를 줄인다.' },
    '게임': { ...GENERIC, product: '규칙에 따라 행동하고 진행 결과를 확인하는 게임', user: '규칙을 처음 접하거나 반복 플레이하는 참가자', goal: '규칙을 이해하고 한 차례의 플레이를 마친다.', decisionMaker: '참여 여부를 결정하는 플레이어. 과금 정책은 아직 정하지 않음.', value: '게임 규칙에 따른 플레이와 결과 경험', scope: '규칙 안내·참여 준비·핵심 플레이·결과 확인. 장르별 추가 기능은 직접 결정.', fit: '진행 상태와 가능한 행동을 분명하게 보여 규칙에 집중하도록 돕는다.' },
    '판매 서비스': SAMPLE_EXAMPLES['판매 서비스'],
    '콘텐츠 서비스': SAMPLE_EXAMPLES['콘텐츠 서비스'],
    '브랜드': { ...GENERIC, product: '제품과 제작 과정을 통해 제공 가치를 설명하는 브랜드 사이트', goal: '제품의 특징과 브랜드의 가치를 이해한다.' }
};
export const PALETTES: Palette[] = [
    { name: 'Quiet focus', label: '조용한 집중', bg: '#f3f2ee', text: '#30342e', accent: '#516b50', font: 'sans-serif', shape: '8px', layout: '정보를 왼쪽 정렬하고 작업 대상을 넓게 배치', material: '장식 없이 무광 표면', motion: '상태 변화에만 160ms 전환' },
    { name: 'Forest & hearth', label: '숲과 따뜻한 거점', bg: '#e7ecdf', text: '#24392f', accent: '#b35c32', font: 'monospace', shape: '0px', layout: '월드를 넓게, HUD와 인벤토리를 주변에 배치', material: '월드와 아이템의 픽셀 외곽선·명암 통일', motion: '상호작용 대상의 짧은 점멸. 화면 흔들림 최소화' },
    { name: 'Digital dressing room', label: '핑크빛 드레스룸', bg: '#fff0f5', text: '#612e47', accent: '#c42e70', font: 'serif', shape: '18px', layout: '사진 미리보기를 중앙에, 도구는 주변에 배치', material: '프레임과 스티커에 리본·진주 재질 대비', motion: '선택한 프레임만 180ms 부드럽게 전환' },
    { name: 'Soft cotton', label: '부드러운 코튼', bg: '#f5eee3', text: '#4f4238', accent: '#996143', font: 'serif', shape: '24px', layout: '큰 이미지와 좁은 설명을 번갈아 배치', material: '브랜드 이미지에만 부드러운 천의 결', motion: '이미지 등장에 200ms 페이드. 본문은 고정' }
];
export function conceptExamples(type: ProductType) { return [PALETTES[0], { ...PALETTES[3], name: 'Warm editorial', label: '따뜻한 읽기 공간', layout: '제목과 핵심 내용을 한 열로 배치하고 행동 버튼을 분리', material: '따뜻한 단색 바탕과 얇은 구분선' }].map((v, i) => ({ ...v, summary: i ? '읽을 내용과 설명에 집중하는 방향' : '상태 정보와 핵심 작업에 집중하는 방향', experience: (EXAMPLES[type] || GENERIC).goal, hero: '실제 콘텐츠와 핵심 작업', typography: i ? '짧은 제목은 세리프, 긴 한글 본문은 산세리프' : '제목과 본문은 산세리프, 크기와 굵기로 구분', intensity: '작업 영역의 장식은 줄이고 선택 상태를 강조', resources: '기본 서체와 단색 패널. 실제 자료는 별도 준비', reference: '자동 분석이 아닌 내장 비교 예시', assumptions: '실제 사용 환경과 서비스 목적에 맞는지 사용자 확인 필요' })); }
export function flowExample(type: ProductType): FlowExample {
    return type === '게임' ? {
        name: '탐험과 거점 발전',
        start: '월드를 선택하고 플레이 시작',
        goal: '거점을 발전시키고 새로운 지역 탐험',
        steps: ['탐험', '채집', '제작', '건설과 정비'],
        roles: ['상호작용 대상을 발견', '재료와 수량 확인', '제작 가능 여부 확인', '설치 위치와 거점 상태 확인'],
        branch: '재료가 부족하면 채집으로 되돌아가기',
        recovery: '중단 시 저장한 거점에서 재개. 사망 손실 정책은 미정.',
        complete: '탐험 → 채집 → 제작 → 건설 → 탐험을 반복',
        loop: true
    } : { name: '사진 완성하기', start: '촬영 또는 사진 가져오기 선택', goal: '꾸민 사진을 이미지로 저장', steps: ['시작', '촬영 또는 가져오기', '네 장 선택', '꾸미기', '완성 확인과 저장'], roles: ['결과 예시와 시작 방법', '사진 입력과 촬영 상태', '마음에 드는 사진 고르기', '사진 중심으로 프레임·장식 편집', '실제 결과 확인과 저장'], branch: '카메라 불가 → 사진 가져오기. 다시 찍기 → 촬영.', recovery: '사진 교체·이전 이동에도 프레임과 편집 상태 유지. 저장 실패 시 다시 시도.', complete: '완성한 이미지를 저장하고 다시 편집 가능', loop: false };
}
export const COMMON_DEFAULT = '사실·사용자 가설·제안을 구분한다. 실제 자료가 없으면 제작 계획으로 명시한다. 빈 상태·실패·대기에서 다음 행동을 설명한다. 실제 결과를 의도와 스타일에 대조하고 수정 후 같은 기준으로 재검토한다.';
export const TYPE_FLOW_EXAMPLES: Partial<Record<ProductType, FlowExample>> = {
    '아직 미정': { name: '핵심 작업과 결과 확인', start: '현재 작업과 가능한 시작 방법 확인', goal: '선택한 작업을 마치고 결과 확인', steps: ['진입', '작업 대상 선택', '핵심 작업', '결과 확인'], roles: ['현재 상태와 시작 방법 안내', '작업할 대상과 조건 선택', '핵심 과제 수행과 상태 피드백', '완료 결과와 이어갈 행동 확인'], branch: '선택할 대상이 없으면 직접 입력하거나 준비 단계로 돌아간다.', recovery: '실패하면 입력과 선택을 유지하고 이전 단계에서 다시 시도한다.', complete: '사용자가 결과를 확인하고 다음 작업을 선택한다.', loop: false },
    '판매 서비스': { name: '리소스 비교와 구매 판단', start: '필요한 작업 규격과 용도 선택', goal: '작업에 맞는 리소스와 사용 조건을 알고 선택', steps: ['목록 탐색', '사양과 미리보기 확인', '사용 조건 비교', '구매 여부 판단'], roles: ['실제 보유 리소스 탐색', '실제 파일 규격과 미리보기 제공', '사용 범위와 확보한 근거 비교', '적합 여부와 미확인 조건 구분'], branch: '사용 조건이 맞지 않으면 목록에서 다른 리소스를 비교한다.', recovery: '자료가 부족하거나 불러오지 못하면 비교 조건과 선택을 보존하고 사양 화면에서 다시 확인한다.', complete: '구매 여부를 판단할 정보가 준비된다. 결제 구현 범위와 실제 가격은 별도로 확인한다.', loop: false },
    '콘텐츠 서비스': { name: '콘텐츠를 찾아 읽고 다시 보기', start: '관심 주제 또는 탐색 조건 선택', goal: '필요한 내용을 이해하고 다시 찾기', steps: ['콘텐츠 탐색', '내용 읽기', '다시 볼 내용 정리'], roles: ['주제와 목록을 비교해 필요한 내용 찾기', '실제 콘텐츠와 출처 읽기', '다시 찾을 방법과 읽은 상태 확인'], branch: '다른 내용이 필요하면 탐색 조건을 유지한 채 목록으로 돌아간다.', recovery: '콘텐츠가 없거나 읽기에 실패하면 이전 탐색 조건을 유지하고 다시 시도한다.', complete: '읽은 내용을 이해하고 다음에 다시 찾을 수 있다. 계정이나 저장 정책은 별도 결정한다.', loop: false },
    '브랜드': { name: '브랜드와 제작 근거 살펴보기', start: '브랜드의 실제 소개와 제공 가치 확인', goal: '재질·제작 방식과 브랜드의 가치를 이해', steps: ['브랜드 소개', '제품과 재질 보기', '제작 과정 확인', '추가 정보 확인'], roles: ['실제로 전달할 가치 소개', '보유 이미지와 구체적인 소재 설명', '확보한 제작 자료와 근거 제시', '남은 의문과 확인 방법 안내'], branch: '관심 있는 제품이나 재질이 다르면 해당 자료를 다시 비교한다.', recovery: '실제 자료가 없으면 제작 계획임을 표시하고 확인 가능한 설명으로 돌아간다.', complete: '사용자가 브랜드의 가치와 확인된 근거를 이해한다. 없는 성과와 고객 후기는 만들지 않는다.', loop: false }
};

