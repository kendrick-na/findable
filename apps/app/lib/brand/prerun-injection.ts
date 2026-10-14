import { isQuestionPrerunEnabled } from "@repo/audit/question-prerun";
import { prerunQuestionsAction } from "@/app/actions/brand/prerun-questions";

/** 질문 미리 돌려 보기를 화면에 주입한다. 기능이 꺼져 있으면 undefined 라 버튼이 아예 보이지 않는다. */
export const prerunInjection = () =>
  isQuestionPrerunEnabled() ? prerunQuestionsAction : undefined;
