"""Findable_GEO리포트_템플릿/build.py 의 compute()·render_strings() 결과를 JSON 으로 뽑는다.

TS 포팅(packages/audit/client-report/compute.ts)과 **같은 값이 나오는지** 대조하는 기준값이다.
build.py main() 은 out/<slug>.pdf 를 다시 굽기 때문에 부르지 않고, 함수만 import 한다.

사용법: python3 scripts/client-report/dump-python-compute.py <템플릿폴더> <slug> > expected.json
"""

import json
import sys
from pathlib import Path

tpl = Path(sys.argv[1]).resolve()
slug = sys.argv[2]
sys.path.insert(0, str(tpl))
import build  # noqa: E402
from jinja2 import Environment, FileSystemLoader  # noqa: E402

cdir = tpl / "clients" / slug
cfg = json.loads((cdir / "config.json").read_text())
audit = json.loads((cdir / "audit.json").read_text())
data = build.compute(cfg, audit)
env = Environment(loader=FileSystemLoader(tpl), autoescape=False)
rendered = build.render_strings(cfg, env, {"s": data["s"], "c": cfg})
print(json.dumps({"compute": data, "config": rendered}, ensure_ascii=False, sort_keys=True))
