"""鞣坑放液门槛：

1. 放液三勾须全勾：渠盖已盖、刮板已收、护栏已复位（空勾清单不算齐）；
2. 最近一次浸液酸碱度须在 3.5～5.0。

登记酸碱度、改成鞣制中均不看三勾。
"""

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0

# (字段名, 三勾清单项)
DRAIN_CHECKS = (
    ("cover_closed", "渠盖已盖"),
    ("scraper_stowed", "刮板已收"),
    ("rail_reset", "护栏已复位"),
)


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def missing_checks(pit: Pit) -> list[str]:
    """未勾上的放液清单项名称；空清单时三项全缺。"""
    return [label for field, label in DRAIN_CHECKS if not getattr(pit, field)]


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    # 只有放液看三勾与酸碱度；注液、鞣制中一律不拦。
    if new_status != Pit.STATUS_DRAINED:
        return
    missing = missing_checks(pit)
    if missing:
        raise RuleError(f"放液前三勾未齐，尚缺：{'、'.join(missing)}")
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
