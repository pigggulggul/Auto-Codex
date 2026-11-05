import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisPreparationControl, AnalysisSources } from "./AnalysisSources";
import type { IssueApi } from "./api";

it("explains why preparation is unavailable until older source copies are reselected", () => {
  const stale = renderToStaticMarkup(<AnalysisPreparationControl loading={false} hasSources hasStaleSources onPrepare={() => {}} />);
  expect(stale).toContain('role="status"');
  expect(stale).toContain("내용이 바뀌었다면 기존 선택을 해제한 뒤 다시 선택해야 합니다.");
  expect(stale).toContain('disabled=""');
  const current = renderToStaticMarkup(<AnalysisPreparationControl loading={false} hasSources hasStaleSources={false} onPrepare={() => {}} />);
  expect(current).not.toContain('disabled=""');
  expect(current).not.toContain('role="status"');
});

it("does not claim the selection is empty before the bridge list is loaded", () => {
  const api = {} as IssueApi;
  const html = renderToStaticMarkup(<AnalysisSources api={api} revision={2} loading={false} setLoading={() => {}} onViewExpired={() => {}} />);
  expect(html).toContain('role="status">선택 자료 목록을 확인해야 합니다.');
  expect(html).not.toContain("선택한 자료가 없습니다.");
  expect(html).not.toContain("선택 0개");
  expect(html).toContain('disabled="">자료 파일 선택</button>');
  expect(html).toContain('disabled="">분석 입력 준비</button>');
  expect(html).toContain('>선택 목록 확인</button>');
});
