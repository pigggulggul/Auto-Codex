import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IssueListControls } from "./IssueBrowser";

it("offers refresh and close actions, and disables both while loading", () => {
  const refresh = vi.fn(), close = vi.fn();
  const controls = IssueListControls({ loading: false, onRefresh: refresh, onClose: close });
  const [refreshButton, closeButton] = controls.props.children;
  refreshButton.props.onClick();
  expect(refresh).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  closeButton.props.onClick();
  expect(close).toHaveBeenCalledOnce();
  const html = renderToStaticMarkup(<IssueListControls loading onRefresh={refresh} onClose={close} />);
  expect(html).toContain('disabled=""');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).toContain("목록 새로고침");
  expect(html).toContain("목록 닫기");
});
