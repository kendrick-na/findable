-- Disposable local PostgreSQL only. Never run against Preview or Production.
-- Fixed free-link job used to verify Next route -> real API -> hydrated action.
INSERT INTO "AuditJob" ("id", "email", "domain", "status", "result", "completedAt")
VALUES (
  '00000000-0000-4000-8000-000000000041',
  'w1-route-fixture@example.invalid',
  'example.invalid',
  'completed',
  jsonb_build_object(
    'brandName', 'W1 Route Fixture',
    'domain', 'example.invalid',
    'mentionVerdictVersion', 2,
    'promptsCount', 10,
    'engineResponses', (
      SELECT jsonb_agg(jsonb_build_object(
        'engineId', 'chatgpt',
        'promptIndex', n - 1,
        'brandMentioned', true,
        'mentionQuality', 'confirmed',
        'mentionPosition', 1,
        'sentiment', 'neutral',
        'sov', 1,
        'durationMs', 10,
        'isStub', false,
        'errorMessage', null,
        'excerpt', 'W1 Route Fixture is a brand.',
        'promptKind', 'brand',
        'promptText', 'What is W1 Route Fixture ' || n || '?'
      ))
      FROM generate_series(1, 10) AS n
    ),
    'metrics', jsonb_build_object(
      'verifiedCount', 10,
      'unverifiedCount', 0,
      'enginesCovered', jsonb_build_array('chatgpt'),
      'enginesWithMention', jsonb_build_array('chatgpt'),
      'errors', jsonb_build_array(),
      'stubCount', 0,
      'sov', 100
    ),
    'geoActions', jsonb_build_array(jsonb_build_object(
      'kind', 'naver_blog',
      'title', '네이버 검색에 잡힐 글을 올리세요',
      'priority', 3,
      'evidence', '이 fixture는 네이버 검색 노출이 없다는 가정 시나리오입니다.',
      'where', '네이버 블로그(회사 공식 계정)',
      'how', '질문에 답하는 페이지를 게시하세요.',
      'verification', '같은 질문에서 네이버 검색 노출이 확인됐는지 다시 측정하세요.',
      'source', '로컬 fixture',
      'guide', jsonb_build_object(
        'evidenceGrade', 'medium',
        'engines', jsonb_build_array('naver'),
        'effectLag', '게시 후 며칠~몇 주',
        'effortHours', jsonb_build_object('min', 2, 'max', 4, 'per', 'total'),
        'remeasureMetric', '같은 질문에서 네이버 검색 노출이 확인된 질문 수',
        'failCondition', '다음 측정에서도 노출이 확인되지 않으면 재점검',
        'notGuaranteed', '게시한다고 네이버 검색 노출이 보장되지는 않습니다.',
        'sources', jsonb_build_array(jsonb_build_object(
          'label', '로컬 fixture 문서', 'url', 'https://example.invalid/evidence'
        ))
      )
    ), jsonb_build_object(
      'kind', 'naver_blog',
      'title', '네이버 블로그에 꾸준히 글을 올리세요',
      'priority', 2,
      'evidence', '기존 측정 근거',
      'how', '기존 실행 방법',
      'verification', '다음 측정에서 네이버·네이버 AI 브리핑·HyperCLOVA X 답변이 우리를 알아봤는지 보세요.',
      'source', '근거 약함 · 기존 출처',
      'guide', jsonb_build_object(
        'evidenceGrade', 'weak',
        'engines', jsonb_build_array('naver', 'naver-briefing', 'hyperclova'),
        'effectLag', '게시 후 몇 주~몇 달',
        'effortHours', jsonb_build_object('min', 1, 'max', 2, 'per', 'week'),
        'remeasureMetric', 'AI가 제대로 알아본 답변 수',
        'failCondition', '네이버 계열 답변에서 알아본 답변이 0건이면 재점검',
        'notGuaranteed', '매주 올리면 네이버 AI 브리핑에 인용된다는 근거는 없습니다.',
        'sources', jsonb_build_array(jsonb_build_object(
          'label', '기존 출처', 'url', 'https://example.invalid/legacy'
        ))
      )
    )),
    'topRecommendations', jsonb_build_array()
  ),
  now()
)
ON CONFLICT ("id") DO UPDATE SET
  "status" = EXCLUDED."status",
  "result" = EXCLUDED."result",
  "completedAt" = EXCLUDED."completedAt";
