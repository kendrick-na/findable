# ui-vendor 월간 보정 샘플 (문서 전용 — 기본으로 실행되는 코드 없음)

> [법률 확인 필요] 업체(Bright Data)가 수집한 소비자 화면 결과를 고객 점수·영업에 쓰려면 법률 검토가 먼저다.
> 이 절차는 **보정(캘리브레이션) 전용**이다. 읽기 전용 쿼리만 쓴다.

## 목적
같은 질문에 대해 세 가지를 나란히 놓고 얼마나 다른지 본다.

| 비교 대상 | 저장 위치(엔진 행 JSON) |
|---|---|
| 주 측정(점수에 쓰이는 값) | 행 자체 (`brandMentioned`, `citedSources` ...) |
| API 검색 후보 | `shadowApiSearch` |
| 업체 화면 수집 후보 | `shadowUiVendor` (`vendorModel`, `webSearchTriggered` 포함) |

## 켜는 법 (운영 반영은 대표 승인 후 · 여기선 설명만)
`UI_VENDOR_SHADOW=true`, `UI_VENDOR_SHADOW_BRANDS=<도메인 쉼표목록>` (비면 아무도 안 돈다),
선택: `UI_VENDOR_TIMEOUT_MS`(기본 120000), `UI_VENDOR_SHADOW_GRACE_MS`(기본 0). 키는 기존 `BRIGHTDATA_API_KEY`.
원가: 성공 레코드 1건 $1.50/1,000 (`costSummary.uiVendorShadowKrw`, totalKrw 불포함). [확인필요: 요금제·물량 단가]

## 월간 샘플 SQL (예시 — 테이블·컬럼명은 실제 스키마로 확인 후 사용)
측정 결과가 JSON(`result.engineResponses[]`)으로 저장된다고 가정한 읽기 전용 예시.

```sql
-- 최근 30일, chatgpt·gemini 행에서 세 값의 "언급 여부"를 비교
SELECT
  r->>'engineId'                                  AS engine,
  count(*)                                        AS rows_total,
  count(*) FILTER (WHERE r ? 'shadowUiVendor'
                   AND r->'shadowUiVendor'->>'outcome' = 'ok') AS vendor_ok,
  count(*) FILTER (WHERE r ? 'shadowApiSearch'
                   AND r->'shadowApiSearch'->>'outcome' = 'ok') AS api_ok,
  -- 업체 vs 주 측정 언급 일치율
  avg((r->'shadowUiVendor'->'comparison'->>'mentionAgreement')::boolean::int)
      FILTER (WHERE r->'shadowUiVendor'->>'outcome' = 'ok')      AS vendor_vs_main_agree,
  -- API 후보 vs 주 측정 언급 일치율
  avg((r->'shadowApiSearch'->'comparison'->>'mentionAgreement')::boolean::int)
      FILTER (WHERE r->'shadowApiSearch'->>'outcome' = 'ok')     AS api_vs_main_agree,
  -- 출처 도메인 겹침 평균
  avg((r->'shadowUiVendor'->'comparison'->>'citationOverlap')::float)
      FILTER (WHERE r->'shadowUiVendor'->>'outcome' = 'ok')      AS vendor_citation_overlap,
  -- 업체가 실제로 웹검색을 켠 비율
  avg((r->'shadowUiVendor'->>'webSearchTriggered')::boolean::int)
      FILTER (WHERE r->'shadowUiVendor'->>'outcome' = 'ok')      AS vendor_web_search_rate
FROM audit_job j,                                   -- 테이블명 [확인필요]
     jsonb_array_elements(j.result->'engineResponses') AS r
WHERE j."createdAt" > now() - interval '30 days'    -- 컬럼명 [확인필요]
  AND r->>'engineId' IN ('chatgpt', 'gemini')
GROUP BY 1;
```

## 실패 분포 (blocked 비율 확인)
```sql
SELECT r->'shadowUiVendor'->>'error' AS err, count(*)
FROM audit_job j, jsonb_array_elements(j.result->'engineResponses') AS r
WHERE r ? 'shadowUiVendor' AND r->'shadowUiVendor'->>'outcome' <> 'ok'
  AND j."createdAt" > now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC;
```

## 읽는 법
- `vendor_vs_main_agree`가 낮으면: API 답과 소비자 화면 답이 자주 다르다 → 보정 필요 신호.
- `[ui-vendor:blocked]` 비율이 높으면 업체 수집 안정성이 낮다 → 표본이 치우칠 수 있다.
- 표본은 허용 도메인(UI_VENDOR_SHADOW_BRANDS)에 한정되므로 전체를 대표하지 않는다.
