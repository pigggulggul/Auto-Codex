import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import type {ConversationSummary} from "../../../shared/protocol";
import {ConversationSidebar,groupConversations} from "./ConversationSidebar";

const conversation = (id:string,projectPath:string|null,workspaceMode:"project"|"research",updatedAt:string):ConversationSummary => ({id,title:id,projectPath,workspaceMode,updatedAt,createdAt:updatedAt,preview:"",messageCount:1});
describe("conversation project groups",()=>{
  it("groups by full folder path and keeps research separate, with recent conversations first",()=>{
    const groups=groupConversations([
      conversation("older","C:\\one\\app","project","2026-01-01"),
      conversation("other","D:\\two\\app","project","2026-01-02"),
      conversation("newer","C:\\one\\app","project","2026-01-03"),
      conversation("research",null,"research","2026-01-04"),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].label).toBe("조사 대화");
    expect(groups.find(group=>group.path==="C:\\one\\app")?.conversations.map(item=>item.id)).toEqual(["newer","older"]);
    expect(groups.filter(group=>group.label==="app")).toHaveLength(2);
  });
  it("escapes saved titles and disables switching while busy",()=>{
    const html=renderToStaticMarkup(<ConversationSidebar conversations={[conversation("<script>bad()</script>",null,"research","2026-01-01")]} activeConversationId="" disabled isPicking={false} onNewResearch={()=>{}} onPickProject={()=>{}} onSelect={()=>{}} onDelete={async()=>{}}/>);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('disabled=""');
    expect(html).toContain("조사 대화");
  });
});
